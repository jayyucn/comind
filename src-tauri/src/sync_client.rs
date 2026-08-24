use std::path::Path;
use std::pin::Pin;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use futures_util::{SinkExt, StreamExt, stream::SplitSink, stream::SplitStream};
use comind_core::sync::{message::SyncMessage, engine::SyncEngine, message::SyncTable};

type Stream = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsSink = SplitSink<Stream, Message>;
type WsSource = SplitStream<Stream>;

/// QR 码解析结果
#[derive(Debug)]
pub struct QrPayload {
    pub ws_url: String,
    pub token: String,
    pub server_name: String,
}

impl QrPayload {
    /// 解析 `comind://pair?ws=ip:port&token=xxx&name=xxx` 格式的 QR 内容
    pub fn parse(qr_text: &str) -> Result<Self, String> {
        let prefix = "comind://pair?";
        let body = qr_text.strip_prefix(prefix).ok_or("Invalid QR format: missing comind://pair? prefix")?;

        let mut ws_url = String::new();
        let mut token = String::new();
        let mut server_name = String::new();

        for pair in body.split('&') {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next().unwrap_or("");
            let value = parts.next().unwrap_or("");
            match key {
                "ws" => ws_url = value.to_string(),
                "token" => token = value.to_string(),
                "name" => server_name = urlencoding::decode(value).map(|s| s.to_string()).unwrap_or_else(|_| value.to_string()),
                _ => {}
            }
        }

        if ws_url.is_empty() || token.is_empty() {
            return Err("Invalid QR format: missing ws or token".to_string());
        }

        Ok(Self { ws_url, token, server_name })
    }
}

#[cfg(test)]
mod qr_payload_tests {
    use super::*;

    #[test]
    fn parse_valid_qr_payload() {
        let qr = "comind://pair?ws=192.168.1.5:8080&token=abc123&name=MyPC";
        let payload = QrPayload::parse(qr).unwrap();
        assert_eq!(payload.ws_url, "192.168.1.5:8080");
        assert_eq!(payload.token, "abc123");
        assert_eq!(payload.server_name, "MyPC");
    }

    #[test]
    fn parse_missing_prefix_fails() {
        let result = QrPayload::parse("http://example.com?ws=1.2.3.4&token=abc");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("comind://pair?"));
    }

    #[test]
    fn parse_missing_ws_fails() {
        let result = QrPayload::parse("comind://pair?token=abc123&name=MyPC");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ws or token"));
    }

    #[test]
    fn parse_missing_token_fails() {
        let result = QrPayload::parse("comind://pair?ws=192.168.1.5:8080&name=MyPC");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ws or token"));
    }

    #[test]
    fn parse_url_encoded_server_name() {
        let qr = "comind://pair?ws=192.168.1.5:8080&token=abc123&name=My%20PC%21";
        let payload = QrPayload::parse(qr).unwrap();
        assert_eq!(payload.server_name, "My PC!");
    }

    #[test]
    fn parse_ignores_unknown_parameters() {
        let qr = "comind://pair?ws=192.168.1.5:8080&token=abc123&extra=ignore&name=PC";
        let payload = QrPayload::parse(qr).unwrap();
        assert_eq!(payload.ws_url, "192.168.1.5:8080");
        assert_eq!(payload.token, "abc123");
        assert_eq!(payload.server_name, "PC");
    }
}

pub struct SyncClient {
    inner: Arc<SyncClientInner>,
}

struct SyncClientInner {
    engine: Arc<SyncEngine>,
    client_id: String,
    device_name: String,
    ws_url: String,
    pairing_token: String,
    server_name: String,
    /// DB 路径（用于持久化配对信息）
    db_path: std::path::PathBuf,
    ws_sink: Arc<Mutex<Option<WsSink>>>,
    ws_source: Arc<Mutex<Option<WsSource>>>,
    is_connected: Arc<RwLock<bool>>,
    is_paired: Arc<RwLock<bool>>,
    reconnect_count: Arc<Mutex<u32>>,
    shutdown: Arc<Mutex<bool>>,
    /// 上次收到对端消息的时间（用于心跳超时检测）
    last_pong: Arc<Mutex<tokio::time::Instant>>,
}

impl Clone for SyncClient {
    fn clone(&self) -> Self {
        Self { inner: self.inner.clone() }
    }
}

impl SyncClient {
    /// 从 QR 码初始化，开专用 DB 连接
    pub fn from_qr(qr_payload: &str, db_path: &Path, device_name: String) -> Result<Self, String> {
        let parsed = QrPayload::parse(qr_payload)?;
        let client_id = uuid::Uuid::new_v4().to_string();
        let engine = Arc::new(SyncEngine::new(client_id.clone(), db_path).map_err(|e| e.to_string())?);

        let ws_url = format!("ws://{}", parsed.ws_url);

        Ok(Self {
            inner: Arc::new(SyncClientInner {
                engine,
                client_id,
                device_name,
                ws_url,
                pairing_token: parsed.token,
                server_name: parsed.server_name,
                db_path: db_path.to_path_buf(),
                ws_sink: Arc::new(Mutex::new(None)),
                ws_source: Arc::new(Mutex::new(None)),
                is_connected: Arc::new(RwLock::new(false)),
                is_paired: Arc::new(RwLock::new(false)),
                reconnect_count: Arc::new(Mutex::new(0)),
                shutdown: Arc::new(Mutex::new(false)),
                last_pong: Arc::new(Mutex::new(tokio::time::Instant::now())),
            }),
        })
    }

    /// 从 DB 中已保存的配对信息恢复 SyncClient（用于 App 重启后自动重连）
    pub fn from_db(db_path: &Path, device_name: String) -> Result<Self, String> {
        let conn = rusqlite::Connection::open(db_path)
            .map_err(|e| format!("Failed to open DB: {}", e))?;
        comind_core::sync::state::SyncStateRepository::migrate_add_ws_url(&conn)
            .map_err(|e| format!("Migration failed: {}", e))?;
        let states = comind_core::sync::state::SyncStateRepository::get_all(&conn)
            .map_err(|e| format!("Failed to read SyncState: {}", e))?;
        let state = states.into_iter().find(|s| s.is_paired)
            .ok_or_else(|| "No paired device found in DB".to_string())?;
        let ws_url = state.ws_url.clone()
            .ok_or_else(|| "Paired device has no ws_url in DB".to_string())?;
        let server_name = state.peer_device_name.clone();
        let client_id = state.client_id.clone();
        let engine = Arc::new(SyncEngine::new(client_id.clone(), db_path)
            .map_err(|e| e.to_string())?);

        log::info!("sync_client::from_db: restored pairing with {} (ws_url={})", server_name, ws_url);
        Ok(Self {
            inner: Arc::new(SyncClientInner {
                engine,
                client_id,
                device_name,
                ws_url,
                // token 为空：重连时 PC 端通过 paired_devices 集合识别已知设备，不验证 token
                pairing_token: String::new(),
                server_name,
                db_path: db_path.to_path_buf(),
                ws_sink: Arc::new(Mutex::new(None)),
                ws_source: Arc::new(Mutex::new(None)),
                is_connected: Arc::new(RwLock::new(false)),
                is_paired: Arc::new(RwLock::new(false)),
                reconnect_count: Arc::new(Mutex::new(0)),
                shutdown: Arc::new(Mutex::new(false)),
                last_pong: Arc::new(Mutex::new(tokio::time::Instant::now())),
            }),
        })
    }

    /// 将配对信息持久化到 DB（配对成功后调用）
    async fn persist_pairing_to_db(&self) {
        let db_path = self.inner.db_path.clone();
        let client_id = self.inner.client_id.clone();
        let server_name = self.inner.server_name.clone();
        let ws_url = self.inner.ws_url.clone();
        let result = tokio::task::spawn_blocking(move || {
            let conn = rusqlite::Connection::open(&db_path)
                .map_err(|e| e.to_string())?;
            comind_core::sync::state::SyncStateRepository::insert_or_update(&conn,
                &comind_core::sync::state::SyncState {
                    client_id,
                    peer_device_name: server_name,
                    last_sync_at: 0,
                    last_sync_type: None,
                    paired_at: Some(chrono::Utc::now().timestamp_millis()),
                    is_paired: true,
                    last_seen_at: Some(chrono::Utc::now().timestamp_millis()),
                    ws_url: Some(ws_url),
                })
                .map_err(|e| e.to_string())
        }).await;
        match result {
            Ok(Ok(())) => log::info!("sync_client: pairing persisted to DB"),
            Ok(Err(e)) => log::error!("sync_client: failed to persist pairing: {}", e),
            Err(e) => log::error!("sync_client: persist task panicked: {}", e),
        }
    }

    /// 连接 WebSocket 并完成配对
    pub async fn connect_and_pair(&self) -> Result<(), String> {
        log::info!("Connecting to {}...", self.inner.ws_url);

        let connect_fut = tokio_tungstenite::connect_async(&self.inner.ws_url);
        let (ws_stream, _) = tokio::time::timeout(Duration::from_secs(10), connect_fut)
            .await
            .map_err(|_| {
                log::error!("WebSocket connect timeout (10s) to {}", self.inner.ws_url);
                format!("连接超时：无法在 10 秒内连接到 PC ({}). 请检查：1) PC 和手机在同一 WiFi; 2) PC 防火墙允许 8080 端口; 3) QR 码中的 IP 地址正确", self.inner.ws_url)
            })?
            .map_err(|e| {
                log::error!("WebSocket connect failed: {}", e);
                format!("WebSocket 连接失败: {}. 请确认 PC 端已启动并检查网络.", e)
            })?;

        let (sink, source) = ws_stream.split();
        *self.inner.ws_sink.lock().await = Some(sink);
        *self.inner.ws_source.lock().await = Some(source);
        *self.inner.is_connected.write().await = true;
        *self.inner.reconnect_count.lock().await = 0;

        log::warn!("sync_client: WebSocket connected to {}, sending pairing...", self.inner.ws_url);

        // 发送配对消息
        let pairing_msg = SyncMessage::Pairing {
            token: self.inner.pairing_token.clone(),
            client_id: self.inner.client_id.clone(),
            device_name: self.inner.device_name.clone(),
        };

        self.send_message(&pairing_msg).await?;

        // 等待 PairingAck
        let paired = self.wait_for_pairing_ack(Duration::from_secs(10)).await?;
        log::warn!("sync_client: wait_for_pairing_ack returned paired={}", paired);

        if paired {
            *self.inner.is_paired.write().await = true;
            log::info!("Paired with PC: {}", self.inner.server_name);

            // 持久化配对信息到 DB（用于重启后自动重连）
            self.persist_pairing_to_db().await;

            // 启动消息接收循环
            self.start_recv_loop().await;
            log::warn!("sync_client: recv_loop started, triggering full sync...");

            // 触发双向全量同步
            self.trigger_bidirectional_full_sync().await;
            log::warn!("sync_client: bidirectional full sync triggered, starting heartbeat...");
        } else {
            return Err("Pairing failed: no ack from server".to_string());
        }

        Ok(())
    }

    /// 启动消息接收循环（独立 task）
    /// 返回 boxed future 以显式标注 Send，避免相互递归导致的 Send 推断失败
    fn start_recv_loop(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        let ws_source = self.inner.ws_source.clone();
        let engine = self.inner.engine.clone();
        let client_id = self.inner.client_id.clone();
        let is_connected = self.inner.is_connected.clone();
        let is_paired = self.inner.is_paired.clone();
        let inner = self.inner.clone();

        Box::pin(async move {
            tokio::spawn(async move {
            loop {
                let msg = {
                    let mut ws_guard = ws_source.lock().await;
                    match ws_guard.as_mut() {
                        Some(stream) => stream.next().await,
                        None => break,
                    }
                };

                match msg {
                    Some(Ok(Message::Text(text))) => {
                        // 收到任何消息即视为对端活跃，刷新心跳超时计时
                        *inner.last_pong.lock().await = tokio::time::Instant::now();
                        match serde_json::from_str::<SyncMessage>(&text) {
                            Ok(sync_msg) => {
                                Self::handle_message(&engine, &client_id, &inner, sync_msg).await;
                            }
                            Err(e) => {
                                log::warn!("Invalid message from server: {}", e);
                            }
                        }
                    }
                    Some(Ok(_)) => {} // 非 Text 消息忽略
                    Some(Err(e)) => {
                        log::error!("WebSocket recv error: {}", e);
                        break;
                    }
                    None => {
                        log::info!("Server disconnected");
                        break;
                    }
                }
            }

            *is_connected.write().await = false;
            *is_paired.write().await = false;

            // 异步触发重连（独立 task，避免与 recv_loop 相互递归）
            let client = SyncClient { inner: inner.clone() };
            tokio::spawn(async move {
                client.start_reconnect().await;
            });
        });
        })
    }

    /// 处理收到的消息
    async fn handle_message(
        engine: &Arc<SyncEngine>,
        client_id: &str,
        inner: &Arc<SyncClientInner>,
        msg: SyncMessage,
    ) {
        match &msg {
            SyncMessage::RowChange { client_id: sender_id, .. } => {
                if sender_id == client_id {
                    return; // 回环检测
                }
                if let Err(e) = engine.handle_message(msg).await {
                    log::error!("Handle RowChange failed: {}", e);
                }
            }
            SyncMessage::FullSyncResponse { .. } => {
                if let Err(e) = engine.handle_message(msg.clone()).await {
                    log::error!("Handle FullSyncResponse failed: {}", e);
                }
                // 检查是否所有批次到齐，提交全量同步
                if let Err(e) = engine.commit_full_sync().await {
                    log::debug!("commit_full_sync (not all batches yet): {}", e);
                }
            }
            SyncMessage::FullSyncRequest { .. } => {
                // PC 请求全量同步 → 回复所有表的 FullSyncResponse
                for &table in SyncTable::all() {
                    match engine.export_full(table, 100).await {
                        Ok(responses) => {
                            let ws_sink = inner.ws_sink.clone();
                            for response in responses {
                                if let Ok(text) = serde_json::to_string(&response) {
                                    let mut ws_guard = ws_sink.lock().await;
                                    if let Some(sink) = ws_guard.as_mut() {
                                        if let Err(e) = sink.send(Message::Text(text)).await {
                                            log::error!("Send FullSyncResponse failed: {}", e);
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => log::error!("Export full sync for {:?} failed: {}", table, e),
                    }
                }
            }
            SyncMessage::PingPong { timestamp: _, .. } => {
                // 回复 Pong
                let pong = SyncMessage::PingPong {
                    client_id: client_id.to_string(),
                    timestamp: chrono::Utc::now().timestamp_millis(),
                };
                let ws_sink = inner.ws_sink.clone();
                let mut ws_guard = ws_sink.lock().await;
                if let Some(sink) = ws_guard.as_mut() {
                    if let Ok(text) = serde_json::to_string(&pong) {
                        let _ = sink.send(Message::Text(text)).await;
                    }
                }
            }
            SyncMessage::PairingAck { .. } => {
                // 已在 wait_for_pairing_ack 中处理
            }
            SyncMessage::Pairing { .. } => {
                // Client 不处理 Pairing
            }
        }
    }

    /// 等待 PairingAck
    async fn wait_for_pairing_ack(&self, timeout: Duration) -> Result<bool, String> {
        let ws_source = self.inner.ws_source.clone();
        let deadline = tokio::time::Instant::now() + timeout;

        loop {
            if tokio::time::Instant::now() >= deadline {
                return Ok(false);
            }

            let remaining = deadline - tokio::time::Instant::now();
            let result = tokio::time::timeout(remaining, async {
                let mut ws_guard = ws_source.lock().await;
                match ws_guard.as_mut() {
                    Some(stream) => stream.next().await,
                    None => None,
                }
            })
            .await;

            match result {
                Ok(Some(Ok(Message::Text(text)))) => {
                    // 收到消息刷新心跳计时
                    *self.inner.last_pong.lock().await = tokio::time::Instant::now();
                    match serde_json::from_str::<SyncMessage>(&text) {
                        Ok(SyncMessage::PairingAck { paired, .. }) => {
                            return Ok(paired);
                        }
                        Ok(other) => {
                            // 非 Ack 消息不能丢弃（可能是配对后首批 FullSync 数据），
                            // 交给 handle_message 处理，避免丢失
                            Self::handle_message(
                                &self.inner.engine,
                                &self.inner.client_id,
                                &self.inner,
                                other,
                            )
                            .await;
                        }
                        Err(e) => {
                            log::warn!("Invalid message during pairing: {}", e);
                        }
                    }
                }
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => return Err(format!("WebSocket error: {}", e)),
                Ok(None) => return Ok(false),
                Err(_) => return Ok(false), // timeout
            }
        }
    }

    /// 发送消息
    async fn send_message(&self, msg: &SyncMessage) -> Result<(), String> {
        let text = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        let msg_preview = &text[..text.len().min(120)];
        log::warn!("sync_client::send_message: sending {} bytes: {}...", text.len(), msg_preview);
        let mut ws_guard = self.inner.ws_sink.lock().await;
        match ws_guard.as_mut() {
            Some(sink) => {
                sink
                    .send(Message::Text(text))
                    .await
                    .map(|_| {
                        log::warn!("sync_client::send_message: sent successfully");
                    })
                    .map_err(|e| format!("Send failed: {}", e))
            }
            None => Err("WebSocket not connected".to_string()),
        }
    }

    /// 触发双向全量同步
    pub async fn trigger_bidirectional_full_sync(&self) {
        log::info!("Triggering bidirectional full sync...");

        // ① Android 拉取 PC 全量数据
        let request = SyncMessage::FullSyncRequest {
            client_id: self.inner.client_id.clone(),
            last_sync_at: None,
        };
        if let Err(e) = self.send_message(&request).await {
            log::error!("Send FullSyncRequest failed: {}", e);
        }

        // ② Android 主动推送自己的全量数据给 PC
        for &table in SyncTable::all() {
            match self.inner.engine.export_full(table, 100).await {
                Ok(responses) => {
                    for response in responses {
                        if let Err(e) = self.send_message(&response).await {
                            log::error!("Send FullSyncResponse for {:?} failed: {}", table, e);
                        }
                    }
                }
                Err(e) => log::error!("Export full sync for {:?} failed: {}", table, e),
            }
        }
    }

    /// 启动重连流程（循环重试，避免递归）
    /// 前 6 次快重试（指数退避 1s→30s），之后切换慢速模式（每 30s 无限重试）
    async fn start_reconnect(&self) {
        loop {
            let current_count = {
                let mut count = self.inner.reconnect_count.lock().await;
                *count += 1;
                *count
            };

            // 前 6 次快重试：指数退避
            // 之后切换慢速模式：每 30s 无限重试
            let backoff = if current_count <= 6 {
                match current_count {
                    1 => Duration::from_secs(1),
                    2 => Duration::from_secs(2),
                    3 => Duration::from_secs(4),
                    4 => Duration::from_secs(8),
                    5 => Duration::from_secs(16),
                    6 => Duration::from_secs(30),
                    _ => Duration::from_secs(30),
                }
            } else {
                if current_count == 7 {
                    log::warn!("sync_client: fast reconnect exhausted, switching to slow mode (30s interval)");
                }
                Duration::from_secs(30)
            };

            log::info!("Reconnect attempt {} in {:?}...", current_count, backoff);
            tokio::time::sleep(backoff).await;

            if *self.inner.shutdown.lock().await {
                log::info!("Shutdown requested, aborting reconnect");
                return;
            }

            // 尝试重新连接
            let ws_url = self.inner.ws_url.clone();
            match tokio_tungstenite::connect_async(&ws_url).await {
                Ok((ws_stream, _)) => {
                    let (sink, source) = ws_stream.split();
                    *self.inner.ws_sink.lock().await = Some(sink);
                    *self.inner.ws_source.lock().await = Some(source);
                    *self.inner.is_connected.write().await = true;
                    *self.inner.reconnect_count.lock().await = 0;
                    *self.inner.last_pong.lock().await = tokio::time::Instant::now();
                    log::info!("Reconnected successfully!");

                    // 重连后重新发送 Pairing 消息
                    let pairing_msg = SyncMessage::Pairing {
                        token: self.inner.pairing_token.clone(),
                        client_id: self.inner.client_id.clone(),
                        device_name: self.inner.device_name.clone(),
                    };
                    if let Err(e) = self.send_message(&pairing_msg).await {
                        log::error!("Reconnect: send pairing failed: {}", e);
                        continue;
                    }
                    let paired = self.wait_for_pairing_ack(Duration::from_secs(10)).await
                        .unwrap_or(false);
                    if !paired {
                        log::error!("Reconnect: pairing failed, retrying...");
                        continue;
                    }
                    *self.inner.is_paired.write().await = true;
                    log::info!("Reconnected and re-paired successfully!");

                    // 持久化配对信息（确保 DB 中有最新 ws_url）
                    self.persist_pairing_to_db().await;

                    // 重连成功后触发双向全量同步
                    self.trigger_bidirectional_full_sync().await;

                    // 重新启动消息接收循环
                    self.start_recv_loop().await;
                    return;
                }
                Err(e) => {
                    log::error!("Reconnect failed (attempt {}): {}", current_count, e);
                    // 继续循环重试
                }
            }
        }
    }

    /// 启动后台重连循环（App 重启后初始连接失败时使用）
    pub async fn start_background_reconnect(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let client = SyncClient { inner };
            client.start_reconnect().await;
        });
    }

    /// 本地数据变更后推送
    pub async fn on_local_change(&self, table: SyncTable, rows: Vec<comind_core::sync::message::RowPayload>) {
        if !*self.inner.is_paired.read().await {
            log::warn!("sync_client::on_local_change: not paired, skipping");
            return;
        }

        match self.inner.engine.on_local_change(table, rows).await {
            Ok(messages) => {
                log::warn!("sync_client::on_local_change: engine returned {} messages", messages.len());
                for msg in messages {
                    if let Err(e) = self.send_message(&msg).await {
                        log::error!("Send local change failed: {}", e);
                    } else {
                        log::warn!("sync_client::on_local_change: sent message successfully");
                    }
                }
            }
            Err(e) => log::error!("on_local_change failed: {}", e),
        }
    }

    /// 从 DB 读取变更行并推送（与 SyncServer.record_and_notify 对应）
    pub async fn record_and_notify(&self, table: SyncTable, ids: Vec<String>) -> Result<(), String> {
        let paired = *self.inner.is_paired.read().await;
        log::warn!("sync_client::record_and_notify table={:?}, ids={:?}, is_paired={}", table, ids, paired);
        if !paired {
            log::warn!("sync_client::record_and_notify: not paired, skipping");
            return Ok(());
        }

        let rows = self.inner.engine.fetch_row_payloads(table, ids).await
            .map_err(|e| e.to_string())?;
        log::warn!("sync_client::record_and_notify: fetched {} rows", rows.len());

        if rows.is_empty() {
            return Ok(());
        }

        self.on_local_change(table, rows).await;
        Ok(())
    }

    /// 手动触发全量同步
    pub async fn trigger_full_sync(&self) -> Result<(), String> {
        self.trigger_bidirectional_full_sync().await;
        Ok(())
    }

    /// 断开连接
    pub async fn disconnect(&self) {
        *self.inner.shutdown.lock().await = true;
        let mut sink_guard = self.inner.ws_sink.lock().await;
        if let Some(sink) = sink_guard.as_mut() {
            let _ = sink.close().await;
        }
        *sink_guard = None;
        *self.inner.ws_source.lock().await = None;
        *self.inner.is_connected.write().await = false;
        *self.inner.is_paired.write().await = false;
        log::info!("SyncClient disconnected");
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        *self.inner.is_connected.read().await
    }

    /// 检查是否已配对
    pub async fn is_paired(&self) -> bool {
        *self.inner.is_paired.read().await
    }

    /// 获取 PC 端设备名
    pub fn get_server_name(&self) -> &str {
        &self.inner.server_name
    }

    /// 启动心跳定时器（30s ping / 90s timeout）
    /// 超时判定基于 inner.last_pong：由 recv_loop 在收到任何对端消息时刷新，
    /// 因此只有真正收到 Pong/数据才算连接存活。
    pub fn start_heartbeat(&self) {
        let ws_sink = self.inner.ws_sink.clone();
        let client_id = self.inner.client_id.clone();
        let is_connected = self.inner.is_connected.clone();
        let inner = self.inner.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));

            loop {
                interval.tick().await;

                if !*is_connected.read().await {
                    continue;
                }

                let ping = SyncMessage::PingPong {
                    client_id: client_id.clone(),
                    timestamp: chrono::Utc::now().timestamp_millis(),
                };

                // 发送 Ping（仅用于探活，不重置 last_pong）
                {
                    let mut ws_guard = ws_sink.lock().await;
                    if let Some(sink) = ws_guard.as_mut() {
                        if let Ok(text) = serde_json::to_string(&ping) {
                            if let Err(e) = sink.send(Message::Text(text)).await {
                                log::warn!("Heartbeat ping send failed: {}", e);
                            }
                        }
                    }
                }

                // 90s timeout 检查：基于上次收到对端消息的时间
                let last = *inner.last_pong.lock().await;
                if last.elapsed() > Duration::from_secs(90) {
                    log::warn!("Heartbeat timeout (no message from server for {:?}), forcing reconnect...", last.elapsed());
                    *is_connected.write().await = false;
                    let client = SyncClient { inner: inner.clone() };
                    tokio::spawn(async move {
                        client.start_reconnect().await;
                    });
                    break;
                }
            }
        });
    }

    /// 启动定时全量校验（30 分钟）
    pub fn start_periodic_full_sync(&self) {
        let inner = self.inner.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1800));

            loop {
                interval.tick().await;

                if !*inner.is_connected.read().await || !*inner.is_paired.read().await {
                    continue;
                }

                log::info!("Periodic full sync triggered (30min)");
                let client = SyncClient { inner: inner.clone() };
                client.trigger_bidirectional_full_sync().await;
            }
        });
    }
}
