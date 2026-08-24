use super::message::SyncMessage;

pub trait SyncTransport {
    fn send(&mut self, msg: &SyncMessage) -> Result<(), Box<dyn std::error::Error>>;
    fn recv(&mut self) -> Result<Option<SyncMessage>, Box<dyn std::error::Error>>;
    fn is_connected(&self) -> bool;
}
