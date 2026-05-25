# BRRRR8 — static file server
# Reads PORT from environment (set by preview tool) or defaults to 3000
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$Root = "C:\Users\demet\brrrr8"

$mime = @{
  '.html'  = 'text/html; charset=utf-8'
  '.css'   = 'text/css; charset=utf-8'
  '.js'    = 'application/javascript; charset=utf-8'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.jpeg'  = 'image/jpeg'
  '.gif'   = 'image/gif'
  '.svg'   = 'image/svg+xml; charset=utf-8'
  '.ico'   = 'image/x-icon'
  '.woff'  = 'font/woff'
  '.woff2' = 'font/woff2'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "BRRRR8 serving $Root on http://localhost:$Port"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch {
    break
  }

  $req = $ctx.Request
  $res = $ctx.Response

  try {
    $local = $req.Url.LocalPath
    if ($local -eq '/' -or $local -eq '') { $local = '/index.html' }

    # Strip query string, prevent traversal
    $local = $local -replace '\?.*', '' -replace '\.\.', ''
    $safe  = $local.TrimStart('/').Replace('/', '\')
    $file  = Join-Path $Root $safe

    if (Test-Path $file -PathType Leaf) {
      $ext  = [IO.Path]::GetExtension($file).ToLower()
      $ct   = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($file)

      $res.StatusCode      = 200
      $res.ContentType     = $ct
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $body  = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $local")
      $res.StatusCode  = 404
      $res.ContentType = 'text/plain'
      $res.OutputStream.Write($body, 0, $body.Length)
    }
  } catch {
    # swallow per-request errors — keep the server alive
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
