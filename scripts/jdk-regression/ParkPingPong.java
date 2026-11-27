import java.nio.file.*;
import java.util.concurrent.locks.LockSupport;

/**
 * Two threads hand a token back and forth with LockSupport.park/unpark only.
 * Prints round trips/s and, per round trip, context switches and user/system CPU.
 *
 * usage: java ParkPingPong.java [kind=platform|virtual] [warmup_s=5] [measure_s=10]
 */
public class ParkPingPong {
    static volatile int turn; // 0: ping's turn, 1: pong's turn
    static volatile boolean running = true;
    static volatile long trips;
    static Thread ping, pong;

    public static void main(String[] a) throws Exception {
        boolean virtual = a.length > 0 && a[0].equals("virtual");
        int warmup = a.length > 1 ? Integer.parseInt(a[1]) : 5, measure = a.length > 2 ? Integer.parseInt(a[2]) : 10;
        Thread.Builder b = virtual ? Thread.ofVirtual() : Thread.ofPlatform().daemon();
        pong = b.unstarted(() -> { while (running) { while (turn != 1 && running) LockSupport.park(); turn = 0; LockSupport.unpark(ping); } });
        ping = b.unstarted(() -> { while (running) { while (turn != 0 && running) LockSupport.park(); trips++; turn = 1; LockSupport.unpark(pong); } });
        pong.start(); ping.start();
        Thread.sleep(warmup * 1000L);
        long n0 = trips; long[] c0 = counters(); long t0 = System.nanoTime();
        Thread.sleep(measure * 1000L);
        long n1 = trips; long[] c1 = counters(); long t1 = System.nanoTime();
        running = false;
        double n = n1 - n0;
        System.out.printf("java=%s kind=%s cpus=%d | round trips/s=%.0f | per trip: vcsw=%.3f nvcsw=%.3f user_us=%.3f sys_us=%.3f%n",
                System.getProperty("java.version"), virtual ? "virtual" : "platform", Runtime.getRuntime().availableProcessors(),
                n / ((t1 - t0) / 1e9), (c1[0] - c0[0]) / n, (c1[1] - c0[1]) / n, 1e6 * (c1[2] - c0[2]) / 100 / n, 1e6 * (c1[3] - c0[3]) / 100 / n);
        System.exit(0);
    }

    static long[] counters() throws Exception {
        long v = 0, nv = 0;
        try (var tasks = Files.newDirectoryStream(Path.of("/proc/self/task"))) {
            for (Path t : tasks)
                for (String l : Files.readAllLines(t.resolve("status"))) {
                    if (l.startsWith("voluntary_ctxt_switches:")) v += Long.parseLong(l.split("\\s+")[1]);
                    else if (l.startsWith("nonvoluntary_ctxt_switches:")) nv += Long.parseLong(l.split("\\s+")[1]);
                }
        }
        String[] st = Files.readString(Path.of("/proc/self/stat")).replaceAll("^.*\\) ", "").split(" ");
        return new long[] {v, nv, Long.parseLong(st[11]), Long.parseLong(st[12])};
    }
}
