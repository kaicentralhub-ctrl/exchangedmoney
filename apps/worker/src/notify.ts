/** Push an alert to ntfy (ntfy.sh or self-hosted). No-op when NTFY_URL is not set. */
export async function notify(ntfyUrl: string | undefined, title: string, message: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!ntfyUrl) {
    console.warn(`[notify] NTFY_URL not set; would have sent: ${title} - ${message}`);
    return;
  }
  const res = await fetcher(ntfyUrl, {
    method: "POST",
    headers: { Title: title, Priority: "high", Tags: "warning" },
    body: message,
  });
  if (!res.ok) console.error(`[notify] ntfy returned HTTP ${res.status}`);
}
