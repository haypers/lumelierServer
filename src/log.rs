//! # Log — Rolling file logging (server + per-show)
//!
//! Two channels: server log in userData/logs/server.txt, show logs in userData/shows/<show_id>/logs/show.txt.
//! Format: UNIXTIMESTAMP-CATEGORY-Subcat: Details (one line per event).
//! A background worker thread receives messages and does append-only writes with size-based rotation (~20MB).

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_SIZE: u64 = 20 * 1024 * 1024; // 20MB
const ROTATED_FILES_KEEP: u32 = 5;
const BUF_WRITER_CAP: usize = 8192;

/// Where to write the log line.
#[derive(Clone, Debug)]
pub enum LogTarget {
    ServerOnly,
    #[allow(dead_code)] // Reserved for show-only events (e.g. optional/DEBUG per LOGGING.md)
    ShowOnly(String),
    ServerAndShow(String),
    CloseShow(String),
}

#[derive(Clone, Debug)]
pub struct LogMessage {
    pub target: LogTarget,
    pub category: String,
    pub subcat: String,
    pub details: String,
}

/// Cloneable sender; worker runs in a dedicated thread.
#[derive(Clone)]
pub struct LogSender {
    tx: Sender<LogMessage>,
}

/// Trait for app state that holds a LogSender (so generic handlers can log).
pub trait LogExt {
    fn log(&self) -> &LogSender;
}

impl LogSender {
    /// Send a message; ignores errors if worker is gone.
    fn send(&self, msg: LogMessage) {
        let _ = self.tx.send(msg);
    }

    pub fn log_server(&self, category: &str, subcat: &str, details: &str) {
        self.send(LogMessage {
            target: LogTarget::ServerOnly,
            category: category.to_string(),
            subcat: subcat.to_string(),
            details: details.to_string(),
        });
    }

    #[allow(dead_code)] // Reserved for show-only events per LOGGING.md
    pub fn log_show(&self, show_id: &str, category: &str, subcat: &str, details: &str) {
        self.send(LogMessage {
            target: LogTarget::ShowOnly(show_id.to_string()),
            category: category.to_string(),
            subcat: subcat.to_string(),
            details: details.to_string(),
        });
    }

    pub fn log_server_and_show(&self, show_id: &str, category: &str, subcat: &str, details: &str) {
        self.send(LogMessage {
            target: LogTarget::ServerAndShow(show_id.to_string()),
            category: category.to_string(),
            subcat: subcat.to_string(),
            details: details.to_string(),
        });
    }

    pub fn close_show(&self, show_id: &str) {
        self.send(LogMessage {
            target: LogTarget::CloseShow(show_id.to_string()),
            category: String::new(),
            subcat: String::new(),
            details: String::new(),
        });
    }
}

/// Sanitize details so the log line stays single-line.
fn sanitize_details(d: &str) -> String {
    d.replace('\n', " ").replace('\r', " ")
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before UNIX_EPOCH")
        .as_secs()
}

fn format_line(category: &str, subcat: &str, details: &str) -> String {
    let secs = unix_secs();
    let details = sanitize_details(details);
    format!("{}-{}-{}: {}\n", secs, category, subcat, details)
}

struct ServerWriter {
    writer: Option<BufWriter<File>>,
    current_size: u64,
    dir: PathBuf,
}

impl ServerWriter {
    fn new(dir: &PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join("server.txt");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let current_size = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(ServerWriter {
            writer: Some(BufWriter::with_capacity(BUF_WRITER_CAP, file)),
            current_size,
            dir: dir.clone(),
        })
    }

    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        if let Some(ref mut w) = self.writer {
            w.write_all(line.as_bytes())?;
            w.flush()?;
        }
        self.current_size += line.len() as u64;
        if self.current_size >= MAX_FILE_SIZE {
            self.rotate()?;
        }
        Ok(())
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        if let Some(w) = self.writer.take() {
            let _ = w.into_inner();
        }
        let path = self.dir.join("server.txt");
        for n in (1..=ROTATED_FILES_KEEP).rev() {
            let from = if n == 1 {
                path.clone()
            } else {
                self.dir.join(format!("server.txt.{}", n - 1))
            };
            let to = self.dir.join(format!("server.txt.{}", n));
            if from.exists() {
                let _ = std::fs::remove_file(&to);
                let _ = std::fs::rename(&from, &to);
            }
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        self.writer = Some(BufWriter::with_capacity(BUF_WRITER_CAP, file));
        self.current_size = 0;
        Ok(())
    }
}

struct ShowWriter {
    writer: Option<BufWriter<File>>,
    current_size: u64,
    dir: PathBuf,
}

impl ShowWriter {
    fn new(dir: &PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join("show.txt");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let current_size = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(ShowWriter {
            writer: Some(BufWriter::with_capacity(BUF_WRITER_CAP, file)),
            current_size,
            dir: dir.clone(),
        })
    }

    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        if let Some(ref mut w) = self.writer {
            w.write_all(line.as_bytes())?;
            w.flush()?;
        }
        self.current_size += line.len() as u64;
        if self.current_size >= MAX_FILE_SIZE {
            self.rotate()?;
        }
        Ok(())
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        if let Some(w) = self.writer.take() {
            let _ = w.into_inner();
        }
        let path = self.dir.join("show.txt");
        for n in (1..=ROTATED_FILES_KEEP).rev() {
            let from = if n == 1 {
                path.clone()
            } else {
                self.dir.join(format!("show.txt.{}", n - 1))
            };
            let to = self.dir.join(format!("show.txt.{}", n));
            if from.exists() {
                let _ = std::fs::remove_file(&to);
                let _ = std::fs::rename(&from, &to);
            }
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        self.writer = Some(BufWriter::with_capacity(BUF_WRITER_CAP, file));
        self.current_size = 0;
        Ok(())
    }
}

fn run_worker(rx: Receiver<LogMessage>, base_path: PathBuf) {
    let logs_dir = base_path.join("logs");
    let shows_path = base_path.join("shows");
    let mut server: Option<ServerWriter> = None;
    let mut shows: HashMap<String, ShowWriter> = HashMap::new();

    while let Ok(msg) = rx.recv() {
        match msg.target {
            LogTarget::CloseShow(show_id) => {
                shows.remove(&show_id);
                continue;
            }
            _ => {}
        }

        let line = format_line(&msg.category, &msg.subcat, &msg.details);

        match &msg.target {
            LogTarget::ServerOnly => {
                if server.is_none() {
                    match ServerWriter::new(&logs_dir) {
                        Ok(w) => server = Some(w),
                        Err(e) => eprintln!("log: failed to open server log: {}", e),
                    }
                }
                if let Some(ref mut w) = server {
                    if let Err(e) = w.write_line(&line) {
                        eprintln!("log: server write failed: {}", e);
                    }
                }
            }
            LogTarget::ShowOnly(show_id) => {
                let dir = shows_path.join(show_id).join("logs");
                if !shows.contains_key(show_id) {
                    match ShowWriter::new(&dir) {
                        Ok(w) => {
                            shows.insert(show_id.clone(), w);
                        }
                        Err(e) => eprintln!("log: failed to open show log {}: {}", show_id, e),
                    }
                }
                if let Some(ref mut w) = shows.get_mut(show_id) {
                    if let Err(e) = w.write_line(&line) {
                        eprintln!("log: show {} write failed: {}", show_id, e);
                    }
                }
            }
            LogTarget::ServerAndShow(show_id) => {
                if server.is_none() {
                    match ServerWriter::new(&logs_dir) {
                        Ok(w) => server = Some(w),
                        Err(e) => eprintln!("log: failed to open server log: {}", e),
                    }
                }
                if let Some(ref mut w) = server {
                    if let Err(e) = w.write_line(&line) {
                        eprintln!("log: server write failed: {}", e);
                    }
                }
                let dir = shows_path.join(show_id).join("logs");
                if !shows.contains_key(show_id) {
                    match ShowWriter::new(&dir) {
                        Ok(w) => {
                            shows.insert(show_id.clone(), w);
                        }
                        Err(e) => eprintln!("log: failed to open show log {}: {}", show_id, e),
                    }
                }
                if let Some(ref mut w) = shows.get_mut(show_id) {
                    if let Err(e) = w.write_line(&line) {
                        eprintln!("log: show {} write failed: {}", show_id, e);
                    }
                }
            }
            LogTarget::CloseShow(_) => {}
        }
    }
}

/// Start the log worker and return a sender. Call from main with base path (e.g. ./userData).
pub fn init(base_path: PathBuf) -> LogSender {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || run_worker(rx, base_path));
    LogSender { tx }
}
