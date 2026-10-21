export async function onRequestGet() {
  return Response.json({
    ok: true,
    service: "free-tools-hub",
    message: "API is running",
    timestamp: new Date().toISOString()
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
