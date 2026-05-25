#!/usr/bin/perl
# BRRRR8 — static file server (pure Perl, no extra modules needed)
use strict;
use warnings;
use IO::Socket::INET;

my $ROOT = 'C:/Users/demet/brrrr8';
my $PORT = $ENV{PORT} // 3000;

my %MIME = (
  html  => 'text/html; charset=utf-8',
  css   => 'text/css; charset=utf-8',
  js    => 'application/javascript; charset=utf-8',
  png   => 'image/png',
  jpg   => 'image/jpeg',
  jpeg  => 'image/jpeg',
  gif   => 'image/gif',
  svg   => 'image/svg+xml; charset=utf-8',
  ico   => 'image/x-icon',
  woff  => 'font/woff',
  woff2 => 'font/woff2',
  txt   => 'text/plain; charset=utf-8',
);

my $server = IO::Socket::INET->new(
  LocalPort => $PORT,
  Listen    => 20,
  ReuseAddr => 1,
  Proto     => 'tcp',
) or die "Cannot bind to port $PORT: $!\n";

# Flush stdout immediately so the preview tool sees the ready signal
$| = 1;
print "BRRRR8 dev server listening on http://localhost:$PORT\n";

while (1) {
  my $client = $server->accept() or next;

  # Read request line
  my $req_line = <$client>;
  last unless defined $req_line;
  $req_line =~ s/\r?\n$//;

  # Drain remaining headers
  while (my $h = <$client>) { last if $h =~ /^\r?\n?$/ }

  # Parse method + path
  my ($method, $raw_path) = $req_line =~ /^(\w+)\s+(\S+)/;
  $raw_path //= '/';

  # Strip query string and fragment
  (my $path = $raw_path) =~ s/[?#].*//;

  # Default to index.html
  $path = '/index.html' if $path eq '/' || $path eq '';

  # Basic path sanity — no directory traversal
  $path =~ s|\.\.||g;
  $path =~ s|//+|/|g;

  my $file = $ROOT . $path;

  # Serve the file
  if (-f $file) {
    my ($ext) = $file =~ /\.([^.]+)$/;
    $ext = lc($ext // 'bin');
    my $ct = $MIME{$ext} // 'application/octet-stream';

    open(my $fh, '<:raw', $file) or do {
      _respond($client, 500, 'text/plain', "500 Cannot open file\n");
      close $client; next;
    };
    local $/; my $body = <$fh>; close $fh;

    print $client "HTTP/1.1 200 OK\r\n"
                . "Content-Type: $ct\r\n"
                . "Content-Length: " . length($body) . "\r\n"
                . "Connection: close\r\n"
                . "\r\n"
                . $body;
  } else {
    my $body = "404 Not Found: $path\n";
    _respond($client, 404, 'text/plain', $body);
  }

  close $client;
}

sub _respond {
  my ($sock, $code, $ct, $body) = @_;
  my %msg = (200 => 'OK', 404 => 'Not Found', 500 => 'Internal Server Error');
  print $sock "HTTP/1.1 $code " . ($msg{$code}//'Unknown') . "\r\n"
            . "Content-Type: $ct\r\n"
            . "Content-Length: " . length($body) . "\r\n"
            . "Connection: close\r\n"
            . "\r\n"
            . $body;
}
