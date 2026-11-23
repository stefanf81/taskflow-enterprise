package com.example.taskflow.catalog.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** The landing pages' promo strip (V45): a single row, id 1; a null message means no strip. */
@Entity
@Table(name = "shop_announcement")
public class ShopAnnouncement {

    public static final short ID = 1;

    @Id
    private Short id;

    @Column(length = 120)
    private String message;

    protected ShopAnnouncement() {
    }

    public ShopAnnouncement(String message) {
        this.id = ID;
        this.message = message;
    }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
}
