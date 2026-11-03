package com.example.taskflow.core;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The shop, bound from {@code app.shop.*}.
 *
 * <ul>
 *   <li>{@code time-zone} (IANA id, default {@code UTC}): the zone of the shop {@code Clock}
 *       ({@link ClockConfig}); an unknown id fails the start.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.shop")
record ShopProperties(@DefaultValue("UTC") String timeZone) {
}
