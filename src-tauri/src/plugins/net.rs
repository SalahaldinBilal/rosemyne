use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};

use crate::image_uploader::{ProgressCallback, chunked_progress_body};

const MAX_REDIRECTS: usize = 5;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 10 * 60_000;

/// Whether `host` is covered by a manifest's network list. `*.example.com` covers
/// subdomains only, never `example.com` itself.
pub fn host_allowed(host: &str, allowed: &[String]) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.parse::<IpAddr>().is_ok() {
        return false;
    }

    allowed.iter().any(|entry| match entry.strip_prefix("*.") {
        Some(suffix) => host
            .strip_suffix(suffix)
            .is_some_and(|rest| rest.len() > 1 && rest.ends_with('.')),
        None => host == *entry,
    })
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    let cgnat = a == 100 && (64..128).contains(&b);
    let ietf_protocol = a == 192 && b == 0 && c == 0;
    let benchmarking = a == 198 && (18..20).contains(&b);
    let reserved = a >= 240;

    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation()
        || a == 0
        || cgnat
        || ietf_protocol
        || benchmarking
        || reserved)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    let unique_local = first & 0xfe00 == 0xfc00;
    let link_local = first & 0xffc0 == 0xfe80;
    let site_local = first & 0xffc0 == 0xfec0;
    // 64:ff9b::/96 and ::/96 embed an IPv4 address that a NAT64 or old stack would connect to.
    let nat64 = ip.segments()[..6] == [0x64, 0xff9b, 0, 0, 0, 0];
    let v4_compatible = ip.segments()[..6] == [0, 0, 0, 0, 0, 0];

    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || unique_local
        || link_local
        || site_local
        || nat64
        || v4_compatible)
}

struct PublicOnlyResolver;

type ResolveError = Box<dyn std::error::Error + Send + Sync>;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(resolve_public(name.as_str().to_owned()))
    }
}

async fn resolve_public(host: String) -> Result<Addrs, ResolveError> {
    let lookup = host.clone();
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        (lookup.as_str(), 0)
            .to_socket_addrs()
            .map(|addrs| addrs.collect::<Vec<SocketAddr>>())
    })
    .await
    .map_err(|err| Box::new(err) as ResolveError)?
    .map_err(|err| Box::new(err) as ResolveError)?;

    let public: Vec<SocketAddr> = resolved.into_iter().filter(|addr| is_public_ip(addr.ip())).collect();
    if public.is_empty() {
        return Err(format!("{host} does not resolve to a public address").into());
    }
    Ok(Box::new(public.into_iter()))
}

fn check_url(url: &reqwest::Url, allowed: &[String]) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("Only https URLs are allowed".into());
    }
    let host = url.host_str().unwrap_or_default();
    if !host_allowed(host, allowed) {
        return Err(format!("{host} is not in this plugin's network list"));
    }
    Ok(())
}

/// One client per plugin, since the redirect policy has to know that plugin's network list.
pub fn build_client(allowed: Vec<String>) -> Result<reqwest::Client, String> {
    let redirect_allowed = allowed.clone();
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("Too many redirects");
        }
        match check_url(attempt.url(), &redirect_allowed) {
            Ok(()) => attempt.follow(),
            Err(err) => attempt.error(err),
        }
    });

    reqwest::Client::builder()
        .dns_resolver(Arc::new(PublicOnlyResolver))
        .redirect(policy)
        .no_proxy()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .user_agent(concat!("Rosemyne/", env!("CARGO_PKG_VERSION"), " plugin"))
        .build()
        .map_err(|err| format!("Couldn't set up the plugin's network client: {err}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    #[serde(default = "default_method")]
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: HttpBody,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".into()
}

#[derive(Debug, Default, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HttpBody {
    #[default]
    None,
    Text {
        text: String,
    },
    Json {
        json: serde_json::Value,
    },
    /// The raw bytes passed as the host function's second argument.
    Bytes,
    CaptureFile,
    Multipart {
        parts: Vec<MultipartPart>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartPart {
    pub name: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub capture_file: bool,
    #[serde(default)]
    pub bytes: bool,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body_length: usize,
}

pub struct HttpInputs {
    pub bytes: Vec<u8>,
    /// The current capture's file, read by the host. `None` when the call has no capture.
    pub capture: Option<CaptureBytes>,
    pub on_progress: Option<ProgressCallback>,
}

pub struct CaptureBytes {
    pub bytes: Vec<u8>,
    pub file_name: String,
    pub mime: String,
}

pub fn wants_capture_file(request: &HttpRequest) -> bool {
    match &request.body {
        HttpBody::CaptureFile => true,
        HttpBody::Multipart { parts } => parts.iter().any(|part| part.capture_file),
        _ => false,
    }
}

fn file_body(bytes: Vec<u8>, on_progress: &mut Option<ProgressCallback>) -> reqwest::Body {
    match on_progress.take() {
        Some(on_progress) => chunked_progress_body(bytes, on_progress),
        None => reqwest::Body::from(bytes),
    }
}

pub async fn execute(
    client: &reqwest::Client,
    allowed: &[String],
    request: HttpRequest,
    mut inputs: HttpInputs,
) -> Result<(HttpResponse, Vec<u8>), String> {
    let url = reqwest::Url::parse(&request.url).map_err(|err| format!("Invalid URL: {err}"))?;
    check_url(&url, allowed)?;

    let method = reqwest::Method::from_bytes(request.method.to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("Invalid method \"{}\"", request.method))?;
    let timeout = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(1_000, MAX_TIMEOUT_MS);

    let mut builder = client.request(method, url).timeout(Duration::from_millis(timeout));

    builder = match request.body {
        HttpBody::None => builder,
        HttpBody::Text { text } => builder.body(text),
        HttpBody::Json { json } => builder.json(&json),
        HttpBody::Bytes => builder.body(std::mem::take(&mut inputs.bytes)),
        HttpBody::CaptureFile => {
            let capture = inputs.capture.take().ok_or("This call has no capture to send")?;
            builder
                .header("Content-Type", capture.mime)
                .body(file_body(capture.bytes, &mut inputs.on_progress))
        }
        HttpBody::Multipart { parts } => {
            let mut form = Form::new();
            for part in parts {
                let built = if part.capture_file {
                    let capture = inputs.capture.take().ok_or("A request can send the capture file once")?;
                    let length = capture.bytes.len() as u64;
                    Part::stream_with_length(file_body(capture.bytes, &mut inputs.on_progress), length)
                        .file_name(part.file_name.unwrap_or(capture.file_name))
                        .mime_str(part.mime.as_deref().unwrap_or(&capture.mime))
                } else if part.bytes {
                    let mut built = Part::bytes(std::mem::take(&mut inputs.bytes));
                    if let Some(file_name) = part.file_name {
                        built = built.file_name(file_name);
                    }
                    built.mime_str(part.mime.as_deref().unwrap_or("application/octet-stream"))
                } else {
                    Ok(Part::text(part.text.unwrap_or_default()))
                }
                .map_err(|_| format!("Invalid mime type for part \"{}\"", part.name))?;
                form = form.part(part.name, built);
            }
            builder.multipart(form)
        }
    };

    for (name, value) in &request.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }

    let mut response = builder.send().await.map_err(|err| describe(&err))?;

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or_default().to_string()))
        .collect();

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|err| describe(&err))? {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(format!("The response is larger than {} MB", MAX_RESPONSE_BYTES / (1024 * 1024)));
        }
        body.extend_from_slice(&chunk);
    }

    Ok((HttpResponse { status, headers, body_length: body.len() }, body))
}

// reqwest's own Display stops at "error sending request"; the cause is in the source chain.
fn describe(err: &reqwest::Error) -> String {
    let mut message = err.to_string();
    let mut source = std::error::Error::source(err);
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|entry| entry.to_string()).collect()
    }

    #[test]
    fn exact_entries_match_only_that_host() {
        let allowed = list(&["api.example.com"]);
        assert!(host_allowed("api.example.com", &allowed));
        assert!(host_allowed("API.Example.com", &allowed));
        assert!(host_allowed("api.example.com.", &allowed));
        assert!(!host_allowed("example.com", &allowed));
        assert!(!host_allowed("evil.api.example.com", &allowed));
        assert!(!host_allowed("api.example.com.evil.net", &allowed));
    }

    #[test]
    fn wildcards_match_subdomains_but_not_the_bare_domain_or_lookalikes() {
        let allowed = list(&["*.example.com"]);
        assert!(host_allowed("cdn.example.com", &allowed));
        assert!(host_allowed("a.b.example.com", &allowed));
        assert!(!host_allowed("example.com", &allowed));
        assert!(!host_allowed("evil-example.com", &allowed));
        assert!(!host_allowed("evilexample.com", &allowed));
        assert!(!host_allowed(".example.com", &allowed));
    }

    #[test]
    fn ip_literals_are_never_allowed() {
        let allowed = list(&["127.0.0.1", "*.0.0.1"]);
        assert!(!host_allowed("127.0.0.1", &allowed));
        assert!(!host_allowed("[::1]", &allowed));
    }

    #[test]
    fn addresses_inside_the_machine_or_lan_are_not_public() {
        for ip in [
            "127.0.0.1",
            "127.8.9.10",
            "10.0.0.5",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:192.168.1.1",
            "::ffff:10.0.0.1",
            "64:ff9b::7f00:1",
            "::7f00:1",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip} should not be public");
        }
    }

    #[test]
    fn ordinary_internet_addresses_are_public() {
        for ip in ["1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"] {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip} should be public");
        }
    }

    #[test]
    fn only_https_urls_on_the_list_pass() {
        let allowed = list(&["api.example.com"]);
        let check = |url: &str| check_url(&reqwest::Url::parse(url).unwrap(), &allowed);
        assert!(check("https://api.example.com/upload").is_ok());
        assert!(check("http://api.example.com/upload").is_err());
        assert!(check("https://other.example.com/").is_err());
        assert!(check("https://api.example.com@evil.net/").is_err());
        assert!(check("https://127.0.0.1/").is_err());
    }
}
