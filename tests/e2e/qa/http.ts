/** Fetch and parse a JSON response; a non-2xx status or a non-JSON body is
 * an error naming the URL and the start of the body. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const failure = new Error(`${url} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
  if (!response.ok) throw failure;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw failure;
  }
}
