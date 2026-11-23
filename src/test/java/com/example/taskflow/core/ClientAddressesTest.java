package com.example.taskflow.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import org.junit.jupiter.api.Test;

class ClientAddressesTest {

    @Test
    void anIpv4AddressIsTheClient() {
        assertEquals("203.0.113.66", ClientAddresses.rateLimitKey("203.0.113.66"));
    }

    @Test
    void anIpv6AddressCountsAsItsSlash64Network() {
        // One subscriber's /64 offers 2^64 addresses: one bucket each used to mean no limit at all.
        String key = ClientAddresses.rateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
        assertEquals("2001:db8:1:2:0:0:0:0/64", key);
        assertEquals(key, ClientAddresses.rateLimitKey("2001:db8:1:2::1"));
        assertEquals(key, ClientAddresses.rateLimitKey("2001:DB8:1:2:0:0:0:ffff"));
        assertNotEquals(key, ClientAddresses.rateLimitKey("2001:db8:1:3::1"));
    }

    @Test
    void bracketsAndZoneIdsDoNotMatter() {
        assertEquals("fe80:0:0:0:0:0:0:0/64", ClientAddresses.rateLimitKey("fe80::1%eth0"));
        assertEquals("2001:db8:1:2:0:0:0:0/64", ClientAddresses.rateLimitKey("[2001:db8:1:2::9]"));
    }

    @Test
    void anIpv4MappedIpv6AddressIsItsIpv4Address() {
        assertEquals("192.0.2.1", ClientAddresses.rateLimitKey("::ffff:192.0.2.1"));
    }

    @Test
    void anythingElseIsLeftAsItIsAndNeverResolved() {
        assertEquals("", ClientAddresses.rateLimitKey(null));
        assertEquals("unknown", ClientAddresses.rateLimitKey("unknown"));
        assertEquals("not:an:address", ClientAddresses.rateLimitKey("not:an:address"));
        assertEquals("localhost", ClientAddresses.rateLimitKey("localhost"));
    }
}
