export function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}
