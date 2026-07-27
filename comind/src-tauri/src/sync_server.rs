use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use futures_util::{SinkExt, StreamExt, stream::{SplitSink, SplitStream}};
use qrcode::QrCode;
use image::{Rgba, ImageEncoder};
use rusqlite::Connection;

use comind_core::sync::{message::SyncMessage, engine::SyncEngine, message::SyncTable, state::SyncStateRepository};
use comind_core::sync::state::SyncState;

type Stream = WebSocketStream<tokio::net::TcpStream>;
type WsSink = SplitSink<Stream, Message>;
type WsSource = SplitStream<Stream>;

/// 当前活跃对端连接的信息（内存态，不持久化）
#[derive(Clone)]
struct PeerInfo {
    name: String,
    ip: String,
    /// 服务端本地为该连接生成的 client_id（用于定位 WebSocket sink）
    local_id: String,
}

/// 前端轮询用的状态结构
#[derive(serde::Serialize)]
pub struct PeerStatus {
    pub client_id: String,
    pub name: String,
    pub ip: String,
}

#[derive(serde::Serialize)]
pub struct SyncServerStatus {
    pub connected: bool,
    pub paired: bool,
    pub peers: Vec<PeerStatus>,
}

pub struct SyncServer {
    inner: Arc<SyncServerInner>,
}

struct SyncServerInner {
    engine: Arc<SyncEngine>,
    clients: Arc<RwLock<HashMap<String, Arc<Mutex<WsSink>>>>>,
    tokens: Arc<RwLock<HashMap<String, (Instant, String)>>>,
    paired_devices: Arc<RwLock<HashSet<String>>>,
    /// 当前活跃连接的对端（key 为对端 client_id）
    connected_peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
    db_path: PathBuf,
    addr: StdMutex<SocketAddr>,
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
                paired_devices: Arc::new(RwLock::new(HashSet::new())),
                connected_peers: Arc::new(RwLock::new(HashMap::new())),
                db_path: db_path.to_path_buf(),
                addr: StdMutex::new(SocketAddr::from(([0, 0, 0, 0], 0))),
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
        *self.inner.addr.lock().unwrap() = local_addr;

        log::info!("SyncServer listening on {}", local_addr);

        let clients = self.inner.clients.clone();
        let engine = self.inner.engine.clone();
        let tokens = self.inner.tokens.clone();
        let paired_devices = self.inner.paired_devices.clone();
        let connected_peers = self.inner.connected_peers.clone();
        let db_path = self.inner.db_path.clone();
        let shutdown = self.inner.shutdown.clone();
        let server_client_id = self.inner.server_client_id.clone();

        tokio::spawn(async move {
            while !*shutdown.lock().await {
                match listener.accept().await {
                    Ok((stream, remote_addr)) => {
                        log::info!("New connection from {}", remote_addr);
                        log::warn!("SyncServer: new connection from {}", remote_addr);
                        let clients_clone = clients.clone();
                        let engine_clone = engine.clone();
                        let tokens_clone = tokens.clone();
                        let paired_devices_clone = paired_devices.clone();
                        let connected_peers_clone = connected_peers.clone();
                        let db_path_clone = db_path.clone();
                        let server_client_id_clone = server_client_id.clone();
                        let peer_ip = remote_addr.ip().to_string();

                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_client(stream, clients_clone, engine_clone, tokens_clone, paired_devices_clone, connected_peers_clone, db_path_clone, server_client_id_clone, peer_ip).await {
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
        *self.inner.addr.lock().unwrap()
    }

    pub fn build_qr_url(&self, token: &str) -> String {
        let ip = Self::get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
        let port = self.get_listen_addr().port();
        format!("comind://pair?ws={}:{}&token={}&name={}", ip, port, token, urlencoding::encode(&self.inner.device_name))
    }

    pub fn generate_qr_image(&self, token: &str) -> Result<String, Box<dyn std::error::Error>> {
        let url = self.build_qr_url(token);
        let code = QrCode::new(url.as_bytes())?;

        let qr_size = code.width();
        let scale = (256 / qr_size).max(1);
        let image_size = qr_size * scale;

        let mut pixels = vec![0u8; (image_size * image_size * 4) as usize];

        for y in 0..qr_size {
            for x in 0..qr_size {
                let color = code[(x, y)];
                let rgba: [u8; 4] = if color == qrcode::Color::Dark {
                    [0, 0, 0, 255]
                } else {
                    [255, 255, 255, 255]
                };
                for dy in 0..scale {
                    for dx in 0..scale {
                        let py = y * scale + dy;
                        let px = x * scale + dx;
                        let idx = (py * image_size + px) * 4;
                        pixels[idx..idx + 4].copy_from_slice(&rgba);
                    }
                }
            }
        }

        let image = image::ImageBuffer::<Rgba<u8>, Vec<u8>>::from_vec(image_size as u32, image_size as u32, pixels)
            .ok_or("Failed to create image buffer")?;

        let mut bytes: Vec<u8> = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes).write_image(
            image.as_raw(),
            image_size as u32,
            image_size as u32,
            image::ExtendedColorType::Rgba8,
        )?;

        use base64::Engine;
        Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
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
                            log::warn!("SyncServer: on_local_change returned 0 messages for {:?}", table);
                            continue;
                        }

                        let clients = clients.read().await;
                        log::warn!("SyncServer: record_and_notify table={:?}, {} messages, {} clients", table, messages.len(), clients.len());
                        for msg in messages {
                            let msg_text = serde_json::to_string(&msg);
                            match msg_text {
                                Ok(text) => {
                                    log::warn!("SyncServer: serialized RowChange, {} bytes, iterating clients", text.len());
                                    for (client_id, stream) in &*clients {
                                        log::warn!("SyncServer: sending to client {}", client_id);
                                        let mut ws = stream.lock().await;
                                        match tokio::time::timeout(Duration::from_secs(5), ws.send(Message::Text(text.clone()))).await {
                                            Ok(Ok(())) => log::warn!("SyncServer: sent RowChange to client {} ({} bytes)", client_id, text.len()),
                                            Ok(Err(e)) => log::error!("Failed to send local change to client {}: {}", client_id, e),
                                            Err(_) => {
                                                log::error!("SyncServer: send to client {} timed out (5s), connection may be dead", client_id);
                                            }
                                        }
                                    }
                                }
                                Err(e) => log::error!("SyncServer: serialize RowChange failed: {}", e),
                            }
                        }
                    } else {
                        log::error!("SyncServer: on_local_change failed for {:?}", table);
                    }
                }
            }
        });

        *timer = Some(handle);
        Ok(())
    }

    /// 当前同步状态（供前端轮询）
    pub async fn get_status(&self) -> SyncServerStatus {
        let peers: Vec<PeerStatus> = self.inner.connected_peers.read().await
            .iter()
            .map(|(cid, p)| PeerStatus {
                client_id: cid.clone(),
                name: p.name.clone(),
                ip: p.ip.clone(),
            })
            .collect();
        let connected = !peers.is_empty();
        SyncServerStatus { connected, paired: connected, peers }
    }

    /// 撤销配对：关闭该对端活跃连接、清除内存与 DB 记录
    pub async fn revoke_device(&self, remote_client_id: &str) {
        let local_id = {
            let peers = self.inner.connected_peers.read().await;
            peers.get(remote_client_id).map(|p| p.local_id.clone())
        };
        if let Some(lid) = local_id {
            let mut clients = self.inner.clients.write().await;
            if let Some(sink) = clients.remove(&lid) {
                let mut s = sink.lock().await;
                let _ = s.close().await;
            }
        }
        self.inner.connected_peers.write().await.remove(remote_client_id);
        self.inner.paired_devices.write().await.remove(remote_client_id);
        let _ = Self::clear_pairing(&self.inner.db_path, remote_client_id).await;
    }

    async fn persist_pairing(db_path: &Path, client_id: &str, name: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open(db_path)?;
        SyncStateRepository::insert_or_update(&conn, &SyncState {
            client_id: client_id.to_string(),
            peer_device_name: name.to_string(),
            last_sync_at: 0,
            last_sync_type: None,
            paired_at: Some(chrono::Utc::now().timestamp_millis()),
            is_paired: true,
            last_seen_at: Some(chrono::Utc::now().timestamp_millis()),
        })?;
        Ok(())
    }

    async fn clear_pairing(db_path: &Path, client_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open(db_path)?;
        SyncStateRepository::delete(&conn, client_id)?;
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
        clients: Arc<RwLock<HashMap<String, Arc<Mutex<WsSink>>>>>,
        engine: Arc<SyncEngine>,
        tokens: Arc<RwLock<HashMap<String, (Instant, String)>>>,
        paired_devices: Arc<RwLock<HashSet<String>>>,
        connected_peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
        db_path: PathBuf,
        server_client_id: String,
        peer_ip: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ws_stream = tokio_tungstenite::accept_async(stream).await?;
        log::warn!("SyncServer: WebSocket handshake succeeded");
        let client_id = uuid::Uuid::new_v4().to_string();

        let (sink, source) = ws_stream.split();
        let client_sink = Arc::new(Mutex::new(sink));
        clients.write().await.insert(client_id.clone(), client_sink.clone());

        tokio::spawn(async move {
            let mut ws = source;
            log::warn!("SyncServer: recv loop started for client {}", client_id);
            loop {
                match ws.next().await {
                    Some(Ok(msg)) => {
                        log::warn!("SyncServer: recv msg type = {}", match msg {
                            Message::Text(_) => "Text",
                            Message::Binary(_) => "Binary",
                            Message::Ping(_) => "Ping",
                            Message::Pong(_) => "Pong",
                            Message::Close(_) => "Close",
                            Message::Frame(_) => "Frame",
                        });
                        if let Message::Text(text) = msg {
                            log::warn!("SyncServer: recv text len={}, preview={}", text.len(), &text[..text.len().min(200)]);
                            match serde_json::from_str::<SyncMessage>(&text) {
                                Ok(sync_msg) => {
                                    log::warn!("SyncServer: parsed msg variant = {}", match &sync_msg { SyncMessage::Pairing{..} => "Pairing", SyncMessage::PairingAck{..} => "PairingAck", SyncMessage::FullSyncRequest{..} => "FullSyncRequest", SyncMessage::FullSyncResponse{..} => "FullSyncResponse", SyncMessage::RowChange{..} => "RowChange", SyncMessage::PingPong{..} => "PingPong" });
                                    match sync_msg {
                                        SyncMessage::Pairing { token, client_id: remote_id, device_name: remote_name } => {
                                            log::warn!("SyncServer: Pairing token={}, remote_id={}, remote_name={}", token, remote_id, remote_name);
                                            let mut tokens = tokens.write().await;
                                            if let Some((created_at, _)) = tokens.remove(&token) {
                                                if created_at.elapsed() < Duration::from_secs(300) {
                                                    paired_devices.write().await.insert(remote_id.clone());
                                                    connected_peers.write().await.insert(remote_id.clone(), PeerInfo {
                                                        name: remote_name.clone(),
                                                        ip: peer_ip.clone(),
                                                        local_id: client_id.clone(),
                                                    });
                                                    let _ = Self::persist_pairing(&db_path, &remote_id, &remote_name).await;
                                                    let response = SyncMessage::PairingAck {
                                                        server_client_id: server_client_id.clone(),
                                                        paired: true,
                                                    };
                                                    let response_text = serde_json::to_string(&response).unwrap();
                                                    let mut sink = client_sink.lock().await;
                                                    if let Err(e) = sink.send(Message::Text(response_text)).await {
                                                        log::error!("Send error: {}", e);
                                                        break;
                                                    }
                                                    log::warn!("SyncServer: Paired with {} ({})", remote_name, remote_id);
                                                } else {
                                                    log::warn!("Token expired");
                                                }
                                            } else {
                                                // Token not found — check if this is a known paired device reconnecting
                                                if paired_devices.read().await.contains(&remote_id) {
                                                    log::warn!("SyncServer: Re-pairing known device {} ({}), allowing reconnect", remote_id, remote_name);
                                                    connected_peers.write().await.insert(remote_id.clone(), PeerInfo {
                                                        name: remote_name.clone(),
                                                        ip: peer_ip.clone(),
                                                        local_id: client_id.clone(),
                                                    });
                                                    let _ = Self::persist_pairing(&db_path, &remote_id, &remote_name).await;
                                                    let response = SyncMessage::PairingAck {
                                                        server_client_id: server_client_id.clone(),
                                                        paired: true,
                                                    };
                                                    let response_text = serde_json::to_string(&response).unwrap();
                                                    let mut sink = client_sink.lock().await;
                                                    if let Err(e) = sink.send(Message::Text(response_text)).await {
                                                        log::error!("Send error: {}", e);
                                                        break;
                                                    }
                                                    log::warn!("SyncServer: Re-paired with {} ({})", remote_name, remote_id);
                                                } else {
                                                    log::warn!("Invalid token (unknown device, not a reconnect)");
                                                }
                                            }
                                        }
                                        SyncMessage::FullSyncRequest { .. } => {
                                            log::warn!("SyncServer: handling FullSyncRequest");
                                            match engine.handle_message(sync_msg).await {
                                                Ok(responses) => {
                                                    log::warn!("SyncServer: FullSyncRequest -> {} responses", responses.len());
                                                    let mut sink = client_sink.lock().await;
                                                    for response in responses {
                                                        let response_text = serde_json::to_string(&response).unwrap();
                                                        if let Err(e) = sink.send(Message::Text(response_text)).await {
                                                            log::error!("Send error: {}", e);
                                                            break;
                                                        }
                                                    }
                                                }
                                                Err(e) => {
                                                    log::warn!("SyncServer: FullSyncRequest handle error: {}", e);
                                                }
                                            }
                                        }
                                        SyncMessage::FullSyncResponse { .. } => {
                                            match engine.handle_message(sync_msg).await {
                                                Ok(responses) => {
                                                    let mut sink = client_sink.lock().await;
                                                    for response in responses {
                                                        let response_text = serde_json::to_string(&response).unwrap();
                                                        if let Err(e) = sink.send(Message::Text(response_text)).await {
                                                            log::error!("Send error: {}", e);
                                                            break;
                                                        }
                                                    }
                                                }
                                                Err(e) => {
                                                    log::warn!("SyncServer: FullSyncResponse handle error: {}", e);
                                                }
                                            }
                                            // 尝试提交全量同步
                                            if let Err(e) = engine.commit_full_sync().await {
                                                log::warn!("SyncServer: commit_full_sync: {}", e);
                                            }
                                        }
                                        SyncMessage::RowChange { table, ref rows, .. } => {
                                            log::warn!("SyncServer: recv RowChange table={:?}, {} rows", table, rows.len());
                                            match engine.handle_message(sync_msg).await {
                                                Ok(responses) => {
                                                    let mut sink = client_sink.lock().await;
                                                    for response in responses {
                                                        let response_text = serde_json::to_string(&response).unwrap();
                                                        if let Err(e) = sink.send(Message::Text(response_text)).await {
                                                            log::error!("Send error: {}", e);
                                                            break;
                                                        }
                                                    }
                                                }
                                                Err(e) => {
                                                    log::warn!("SyncServer: RowChange handle error: {}", e);
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

            // 清理活跃对端记录（按 local id 反查 remote_id 后移除）
            {
                let mut peers = connected_peers.write().await;
                if let Some(key) = peers.iter().find(|(_, p)| p.local_id == client_id).map(|(k, _)| k.clone()) {
                    peers.remove(&key);
                }
            }
            clients.write().await.remove(&client_id);
        });

        Ok(())
    }
}




