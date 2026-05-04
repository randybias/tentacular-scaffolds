use strict;
use warnings;
use IO::Socket::INET;
## Time::HiRes not available in linuxserver/ffmpeg — use built-in time()

$| = 1;  # autoflush

my $server = IO::Socket::INET->new(
    LocalAddr => '0.0.0.0', LocalPort => 9000,
    Proto => 'tcp', Listen => 5, ReuseAddr => 1,
) or die "Cannot bind :9000: $!\n";

print "ffmpeg HTTP wrapper listening on :9000\n";

while (my $client = $server->accept()) {
    my $req = '';
    while (my $line = <$client>) {
        $req .= $line;
        last if $line =~ /^\r?\n$/;
    }
    my ($method, $path) = $req =~ /^(\w+)\s+(\S+)/;
    $method //= ''; $path //= '';

    my $cl = 0;
    $cl = $1 if $req =~ /Content-Length:\s*(\d+)/i;
    my $body = '';
    if ($cl > 0) { read($client, $body, $cl); }

    if ($method eq 'GET' && $path eq '/health') {
        http_json($client, 200, '{"status":"ok"}');
    }
    elsif ($method eq 'POST' && $path eq '/download-youtube') {
        my ($url) = $body =~ /"url"\s*:\s*"([^"]*)"/;
        my ($output) = $body =~ /"output"\s*:\s*"([^"]*)"/;
        $url //= '';
        $output //= '/shared/input/video.mp4';

        if ($output =~ /\.\./) {
            http_json($client, 400, '{"error":"path traversal not allowed"}');
            close $client;
            next;
        }
        if ($url !~ /^https?:\/\//) {
            http_json($client, 400, '{"error":"invalid url"}');
            close $client;
            next;
        }

        # yt-dlp is downloaded at sidecar startup (see workflow.yaml args)
        if (! -x '/tmp/yt-dlp') {
            http_json($client, 500, '{"error":"yt-dlp not installed — check sidecar startup logs"}');
            close $client;
            next;
        }

        # Ensure parent directory exists
        my $parent = $output;
        $parent =~ s|/[^/]+$||;
        if (! -d $parent) {
            require File::Path;
            File::Path::make_path($parent);
        }

        my $t0 = time();
        my @cmd = (
            '/tmp/yt-dlp',
            '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
            '-o', $output,
            '--no-playlist',
            '--no-warnings',
            $url,
        );

        my $dl_out = '';
        my $pid = open(my $pipe, '-|');
        if (defined $pid && $pid == 0) {
            open(STDERR, '>&', \*STDOUT);
            exec(@cmd) or exit(127);
        }
        if (defined $pid) {
            local $/;
            $dl_out = <$pipe> // '';
            close $pipe;
        }
        my $rc = $? >> 8;
        my $duration_ms = (time() - $t0) * 1000;

        if ($rc != 0 || ! -f $output) {
            my $err = substr($dl_out, 0, 500);
            $err =~ s/\\/\\\\/g;
            $err =~ s/"/\\"/g;
            $err =~ s/\n/\\n/g;
            http_json($client, 500, qq({"error":"yt-dlp exit $rc: $err"}));
        }
        else {
            my $size = -s $output;
            # Extract title from yt-dlp output
            my ($title) = $dl_out =~ /\[download\]\s+Destination:\s+(.+)/;
            $title //= '';
            $title =~ s/\\/\\\\/g;
            $title =~ s/"/\\"/g;
            http_json($client, 200,
                qq({"output":"$output","size_bytes":$size,"duration_ms":$duration_ms,"title":"$title"}));
        }
    }
    elsif ($method eq 'POST' && $path eq '/extract-frames') {
        my ($input) = $body =~ /"input"\s*:\s*"([^"]*)"/;
        my ($fps_str) = $body =~ /"fps"\s*:\s*(\d+(?:\.\d+)?)/;
        my ($output_dir) = $body =~ /"output_dir"\s*:\s*"([^"]*)"/;
        $input //= '';
        $fps_str //= '1';
        $output_dir //= '/shared/output';

        # Validate paths to prevent traversal
        if ($input =~ /\.\./ || $output_dir =~ /\.\./) {
            http_json($client, 400, '{"error":"path traversal not allowed"}');
            close $client;
            next;
        }

        my $fps = $fps_str + 0;
        $fps = 1 if $fps <= 0;

        my $t0 = time();

        # Ensure output directory exists
        if (! -d $output_dir) {
            require File::Path;
            File::Path::make_path($output_dir);
        }

        # SECURITY: list-form exec bypasses shell interpolation
        # Fork+exec to capture stderr via pipe (list-form open can't do 2>&1)
        my @cmd = (
            'ffmpeg', '-y', '-i', $input,
            '-vf', "fps=$fps",
            '-q:v', '2',
            "$output_dir/frame_%04d.jpg"
        );

        my $stderr_out = '';
        my $pid = open(my $pipe, '-|');
        if (defined $pid && $pid == 0) {
            open(STDERR, '>&', \*STDOUT);
            exec(@cmd) or exit(127);
        }
        if (defined $pid) {
            local $/;
            $stderr_out = <$pipe> // '';
            close $pipe;
        }
        my $rc = $? >> 8;

        my $duration_ms = (time() - $t0) * 1000;

        if ($rc != 0) {
            my $err = substr($stderr_out, 0, 500);
            $err =~ s/\\/\\\\/g;
            $err =~ s/"/\\"/g;
            $err =~ s/\n/\\n/g;
            http_json($client, 500, qq({"error":"ffmpeg exit $rc: $err"}));
        }
        else {
            # Glob output frames and sort lexicographically
            my @frames = sort glob("$output_dir/frame_*.jpg");
            my $count = scalar @frames;
            my $frames_json = join(',', map { qq("$_") } @frames);
            http_json($client, 200,
                qq({"frames":[$frames_json],"count":$count,"duration_ms":$duration_ms,"input":"$input","fps":$fps,"output_dir":"$output_dir"}));
        }
    }
    else {
        http_json($client, 404, '{"error":"not found"}');
    }
    close $client;
}

sub http_json {
    my ($fh, $code, $json) = @_;
    my $status = $code == 200 ? 'OK' : $code == 404 ? 'Not Found' : 'Error';
    print $fh "HTTP/1.1 $code $status\r\n";
    print $fh "Content-Type: application/json\r\n";
    print $fh "Content-Length: " . length($json) . "\r\n";
    print $fh "Connection: close\r\n";
    print $fh "\r\n";
    print $fh $json;
}
