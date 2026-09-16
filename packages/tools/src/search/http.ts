/** The response when it is 2xx; otherwise an Error naming the provider, the status and the body's first line. */
export async function checked(provider: string, pending: Promise<Response>): Promise<Response> {
  const response = await pending.catch((e: Error) => {
    throw new Error(`${provider}: ${(e.cause as { code?: string } | undefined)?.code ?? e.message}`);
  });
  if (response.ok) return response;
  const body = (await response.text().catch(() => '')).split('\n')[0]!.slice(0, 200);
  throw new Error(`${provider}: HTTP ${response.status}${body ? ` ${body}` : ''}`);
}
