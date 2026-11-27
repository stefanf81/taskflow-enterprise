import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.LockSupport;

/**
 * Models the hot path of a virtual-thread web service that talks to Redis through
 * Lettuce's synchronous API: each "request" runs on a virtual thread, does a little
 * CPU work, then makes CALLS round trips. A round trip hands a command to a single
 * platform "event loop" thread and waits for the reply with
 * CompletableFuture.get(timeout) (timed park -> ForkJoinPool delayed task) or, with
 * MODE=untimed, CompletableFuture.get() (untimed park).
 *
 * Prints requests/s and, per request, the process's voluntary / involuntary context
 * switches and user / system CPU (Linux /proc).
 *
 * usage: java TimedWaitBench.java [threads=50] [calls=3] [work_us=20] [warmup_s=10] [measure_s=20] [mode=timed|untimed] [kind=virtual|platform]
 */
public class TimedWaitBench {
    static final ConcurrentLinkedQueue<CompletableFuture<Integer>> inbox = new ConcurrentLinkedQueue<>();
    static volatile Thread loop;
    static final AtomicBoolean loopParked = new AtomicBoolean();
    static volatile boolean running = true;
    static final LongAdder requests = new LongAdder();
    static volatile long sink;

    public static void main(String[] a) throws Exception {
        int threads = a.length > 0 ? Integer.parseInt(a[0]) : 50;
        int calls = a.length > 1 ? Integer.parseInt(a[1]) : 3;
        long workNs = (a.length > 2 ? Long.parseLong(a[2]) : 20) * 1000;
        int warmup = a.length > 3 ? Integer.parseInt(a[3]) : 10;
        int measure = a.length > 4 ? Integer.parseInt(a[4]) : 20;
        boolean timed = !(a.length > 5 && a[5].equals("untimed"));
        boolean virtual = !(a.length > 6 && a[6].equals("platform"));

        loop = Thread.ofPlatform().name("event-loop").daemon().start(() -> {
            while (running) {
                CompletableFuture<Integer> f = inbox.poll();
                if (f == null) {
                    loopParked.set(true);
                    if (inbox.isEmpty()) LockSupport.parkNanos(1_000_000);
                    loopParked.set(false);
                    continue;
                }
                spin(2_000); // "decode the reply"
                f.complete(42);
            }
        });

        for (int i = 0; i < threads; i++) {
            (virtual ? Thread.ofVirtual() : Thread.ofPlatform().daemon()).start(() -> {
                try {
                    while (running) {
                        spin(workNs);
                        for (int c = 0; c < calls; c++) {
                            CompletableFuture<Integer> f = new CompletableFuture<>();
                            inbox.add(f);
                            if (loopParked.get()) LockSupport.unpark(loop);
                            sink += timed ? f.get(1, TimeUnit.SECONDS) : f.get();
                        }
                        requests.increment();
                    }
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            });
        }

        Thread.sleep(warmup * 1000L);
        long r0 = requests.sum(); long[] c0 = counters(); long t0 = System.nanoTime();
        Thread.sleep(measure * 1000L);
        long r1 = requests.sum(); long[] c1 = counters(); long t1 = System.nanoTime();
        running = false;
        double n = r1 - r0, tick = 100.0;
        System.out.printf("java=%s mode=%s kind=%s threads=%d calls=%d work_us=%d cpus=%d | req/s=%.0f | per request: vcsw=%.3f nvcsw=%.3f user_us=%.2f sys_us=%.2f%n",
                System.getProperty("java.version"), timed ? "timed" : "untimed", virtual ? "virtual" : "platform", threads, calls, workNs / 1000,
                Runtime.getRuntime().availableProcessors(), n / ((t1 - t0) / 1e9),
                (c1[0] - c0[0]) / n, (c1[1] - c0[1]) / n, 1e6 * (c1[2] - c0[2]) / tick / n, 1e6 * (c1[3] - c0[3]) / tick / n);
        System.exit(0);
    }

    static void spin(long ns) {
        long end = System.nanoTime() + ns, x = 0;
        while (System.nanoTime() < end) x += x * 31 + 7;
        sink += x;
    }

    /** voluntary, involuntary context switches (all threads), utime, stime (ticks). */
    static long[] counters() throws Exception {
        long v = 0, nv = 0;
        try (var tasks = Files.newDirectoryStream(Path.of("/proc/self/task"))) {
            for (Path t : tasks) {
                for (String line : Files.readAllLines(t.resolve("status"))) {
                    if (line.startsWith("voluntary_ctxt_switches:")) v += Long.parseLong(line.split("\\s+")[1]);
                    else if (line.startsWith("nonvoluntary_ctxt_switches:")) nv += Long.parseLong(line.split("\\s+")[1]);
                }
            }
        }
        String[] stat = Files.readString(Path.of("/proc/self/stat")).replaceAll("^.*\\) ", "").split(" ");
        return new long[] {v, nv, Long.parseLong(stat[11]), Long.parseLong(stat[12])};
    }
}
