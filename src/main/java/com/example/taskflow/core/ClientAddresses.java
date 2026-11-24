package com.example.taskflow.core;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;

/**
 * The client a rate limit counts, derived from the request's client address
 * ({@code getRemoteAddr()}, normalised by the trusted-proxy valve).
 *
 * <p>An IPv4 address is the client. An IPv6 address stands for its /64 network: a subscriber is
 * normally assigned a whole /64 and can use any of its 2<sup>64</sup> addresses, so keying on the
 * full address gave one client an unlimited number of buckets (BENCHMARKS.md §80). An IPv4-mapped
 * IPv6 address ({@code ::ffff:192.0.2.1}) is its IPv4 address. Anything that is not an address
 * literal is returned unchanged; no name is ever resolved.
 */
public final class ClientAddresses {

    private static final int NETWORK_BYTES = 8; // /64

    private ClientAddresses() {}

    /** The rate-limit client of {@code address}; {@code ""} for none. */
    public static String rateLimitKey(String address) {
        if (address == null) {
            return "";
        }
        if (address.indexOf(':') < 0) {
            return address; // IPv4 (or not an address at all)
        }
        String literal = address;
        if (literal.startsWith("[") && literal.endsWith("]")) {
            literal = literal.substring(1, literal.length() - 1);
        }
        int zone = literal.indexOf('%');
        if (zone >= 0) {
            literal = literal.substring(0, zone);
        }
        try {
            InetAddress parsed = InetAddress.ofLiteral(literal); // a literal only: never a lookup
            if (parsed instanceof Inet4Address) {
                return parsed.getHostAddress(); // IPv4-mapped
            }
            byte[] network = Arrays.copyOf(parsed.getAddress(), 16);
            Arrays.fill(network, NETWORK_BYTES, network.length, (byte) 0);
            return InetAddress.getByAddress(network).getHostAddress() + "/64";
        } catch (IllegalArgumentException | UnknownHostException e) {
            return address;
        }
    }
}
