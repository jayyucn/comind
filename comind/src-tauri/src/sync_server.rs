use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use futures_util::{SinkExt, StreamExt};
use qrcode::QrCode;
use image::{Rgba, ImageBuffer};

use comind_core::sync::{message::SyncMessage, engine::SyncEngine, message::SyncTable};

type Stream = WebSocketStream<tokio::net::TcpStream>;

pub struct SyncServer {
    inner: Arc<SyncServerInner>,
}

struct SyncServerInner {
    engine: Arc<SyncEngine>,
    clients: Arc<RwLock<HashMap<String, Arc<Mutex<Stream>>>>>,
    tokens: Arc<RwLock<HashMap<String, (Instant, String)>>>,
    addr: Mutex<SocketAddr>,
    shutdown: Arc<Mutex<bool>>,
    device_name: String,
    server_client_id: String,
    debounce_timer: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    debounce_changes: Arc<Mutex<HashMap<SyncTable, Vec<String>>>>,
}

impl Clone for SyncServer {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl SyncServer {
    pub fn new(db_path: &Path, device_name: String) -> Result<Self, Box<dyn std::error::Error>> {
        let server_client_id = uuid::Uuid::new_v4().to_string();
        let engine = Arc::new(SyncEngine::new(server_client_id.clone(), db_path)?);
        
        Ok(Self {
            inner: Arc::new(SyncServerInner {
                engine,
                clients: Arc::new(RwLock::new(HashMap::new())),
                tokens: Arc::new(RwLock::new(HashMap::new())),
                addr: Mutex::new(SocketAddr::from(([0, 0, 0, 0], 0))),
                shutdown: Arc::new(Mutex::new(false)),
                device_name,
                server_client_id,
                debounce_timer: Arc::new(Mutex::new(None)),
                debounce_changes: Arc::new(Mutex::new(HashMap::new())),
            }),
        })
    }

    pub async fn start(&mut self, port: u16) -> Result<(), Box<dyn std::error::Error>> {
        let addr = format!("0.0.0.0:{}", port);
        let listener = tokio::net::TcpListener::bind(&addr).await?;
        let local_addr = listener.local_addr()?;
        *self.inner.addr.lock().await = local_addr;
        
        log::info!("SyncServer listening on {}", local_addr);
        
        let clients = self.inner.clients.clone();
        let engine = self.inner.engine.clone();
        let tokens = self.inner.tokens.clone();
        let shutdown = self.inner.shutdown.clone();
        let server_client_id = self.inner.server_client_id.clone();
        
        tokio::spawn(async move {
            while !*shutdown.lock().await {
                match listener.accept().await {
                    Ok((stream, remote_addr)) => {
                        log::info!("New connection from {}", remote_addr);
                        let clients_clone = clients.clone();
                        let engine_clone = engine.clone();
                        let tokens_clone = tokens.clone();
                        let server_client_id_clone = server_client_id.clone();
                        
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_client(stream, clients_clone, engine_clone, tokens_clone, server_client_id_clone).await {
                                log::error!("Client handler error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("Accept error: {}", e);
                    }
                }
            }
        });
        
        Ok(())
    }

    pub async fn generate_pairing_token(&self) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.inner.tokens.write().await.insert(token.clone(), (Instant::now(), self.inner.device_name.clone()));
        token
    }

    pub fn get_listen_addr(&self) -> SocketAddr {
        *self.inner.addr.blocking_lock()
    }

    pub fn build_qr_url(&self, token: &str) -> String {
        let ip = Self::get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
        let port = self.get_listen_addr().port();
        format!("comind://pair?ws={}:{}&token={}&name={}", ip, port, token, urlencoding::encode(&self.inner.device_name))
    }

    pub fn generate_qr_image(&self, token: &str) -> Result<String, Box<dyn std::error::Error>> {
        let url = self.build_qr_url(token);
        let code = QrCode::new(url.as_bytes())?;
        
        let image_size = 256;
        let qr_size = code.width();
        let scale = image_size / qr_size;
        
        let mut pixels = Vec::with_capacity(image_size * image_size);
        
        for y in 0..qr_size {
            for _ in 0..scale {
                for x in 0..qr_size {
                    let color = code[(x, y)];
                    for _ in 0..scale {
                        if color == qrcode::Color::Dark {
                            pixels.extend_from_slice(&[0, 0, 0, 255]);
                        } else {
                            pixels.extend_from_slice(&[255, 255, 255, 255]);
                        }
                    }
                }
            }
        }
        
        let image = ImageBuffer::<Rgba<u8>, _>::from_vec(image_size as u32, image_size as u32, pixels)
            .ok_or("Failed to create image buffer")?;
        
        let mut bytes: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let mut buf_writer = std::io::BufWriter::new(&mut bytes);
            image::codecs::png::PngEncoder::new(&mut buf_writer).encode(
                &image,
                image_size as u32,
                image_size as u32,
                image::ColorType::Rgba8,
            )?;
        }
        
        Ok(base64::encode(&bytes))
    }

    pub async fn trigger_full_sync(&self) -> Result<(), Box<dyn std::error::Error>> {
        let clients = self.inner.clients.read().await;
        for (_client_id, stream) in &*clients {
            let request = SyncMessage::FullSyncRequest {
                client_id: self.inner.server_client_id.clone(),
                last_sync_at: None,
            };
            let request_text = serde_json::to_string(&request)?;
            let mut ws = stream.lock().await;
            ws.send(Message::Text(request_text)).await?;
        }
        Ok(())
    }

    pub async fn record_and_notify(&self, table: SyncTable, ids: Vec<String>) -> Result<(), Box<dyn std::error::Error>> {
        let mut changes = self.inner.debounce_changes.lock().await;
        let entry = changes.entry(table).or_insert_with(Vec::new);
        for id in ids {
            if !entry.contains(&id) {
                entry.push(id);
            }
        }
        
        let mut timer = self.inner.debounce_timer.lock().await;
        if let Some(handle) = timer.take() {
            handle.abort();
        }
        
        let engine = self.inner.engine.clone();
        let clients = self.inner.clients.clone();
        let debounce_changes = self.inner.debounce_changes.clone();
        
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            
            let changes = {
                let mut lock = debounce_changes.lock().await;
                std::mem::take(&mut *lock)
            };
            
            for (table, ids) in changes {
                if let Ok(rows) = engine.fetch_row_payloads(table, ids).await {
                    if rows.is_empty() {
                        continue;
                    }
                    
                    if let Ok(messages) = engine.on_local_change(table, rows).await {
                        if messages.is_empty() {
                            continue;
                        }
                        
                        let clients = clients.read().await;
                        for msg in messages {
                            if let Ok(msg_text) = serde_json::to_string(&msg) {
                                for (_client_id, stream) in &*clients {
                                    let mut ws = stream.lock().await;
                                    if let Err(e) = ws.send(Message::Text(msg_text.clone())).await {
                                        log::error!("Failed to send local change to client: {}", e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        
        *timer = Some(handle);
        Ok(())
    }

    fn get_local_ip() -> Option<String> {
        // Use std::net to find the local IP used for outbound connections.
        // This avoids the get_if_addrs crate which requires C compilation
        // and doesn't support Android NDK's versioned target triples.
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect("8.8.8.8:80").ok()?;
        let addr = socket.local_addr().ok()?;
        Some(addr.ip().to_string())
    }

    async fn handle_client(
        stream: tokio::net::TcpStream,
        clients: Arc<RwLock<HashMap<String, Arc<Mutex<Stream>>>>>,
        engine: Arc<SyncEngine>,
        tokens: Arc<RwLock<HashMap<String, (Instant, String)>>>,
        server_client_id: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ws_stream = tokio_tungstenite::accept_async(stream).await?;
        let client_id = uuid::Uuid::new_v4().to_string();
        
        let client_stream = Arc::new(Mutex::new(ws_stream));
        clients.write().await.insert(client_id.clone(), client_stream.clone());
        
        tokio::spawn(async move {
            let mut ws = client_stream.lock().await;
            loop {
                match ws.next().await {
                    Some(Ok(msg)) => {
                        if let Message::Text(text) = msg {
                            match serde_json::from_str::<SyncMessage>(&text) {
                                Ok(sync_msg) => {
                                    match sync_msg {
                                        SyncMessage::Pairing { token, client_id: remote_id, device_name: remote_name } => {
                                            let mut tokens = tokens.write().await;
                                            if let Some((created_at, _)) = tokens.remove(&token) {
                                                if created_at.elapsed() < Duration::from_secs(300) {
                                                    let response = SyncMessage::PairingAck {
                                                        server_client_id: server_client_id.clone(),
                                                        paired: true,
                                                    };
                                                    let response_text = serde_json::to_string(&response).unwrap();
                                                    if let Err(e) = ws.send(Message::Text(response_text)).await {
                                                        log::error!("Send error: {}", e);
                                                        break;
                                                    }
                                                    log::info!("Paired with {} ({})", remote_name, remote_id);
                                                } else {
                                                    log::warn!("Token expired");
                                                }
                                            } else {
                                                log::warn!("Invalid token");
                                            }
                                        }
                                        SyncMessage::FullSyncRequest { .. } => {
                                            if let Ok(responses) = engine.handle_message(sync_msg).await {
                                                for response in responses {
                                                    let response_text = serde_json::to_string(&response).unwrap();
                                                    if let Err(e) = ws.send(Message::Text(response_text)).await {
                                                        log::error!("Send error: {}", e);
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        SyncMessage::RowChange { .. } => {
                                            if let Ok(responses) = engine.handle_message(sync_msg).await {
                                                for response in responses {
                                                    let response_text = serde_json::to_string(&response).unwrap();
                                                    if let Err(e) = ws.send(Message::Text(response_text)).await {
                                                        log::error!("Send error: {}", e);
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Invalid message: {}", e);
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        log::error!("WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        log::info!("Client disconnected: {}", client_id);
                        break;
                    }
                }
            }
            
            clients.write().await.remove(&client_id);
        });

        Ok(())
    }
}
