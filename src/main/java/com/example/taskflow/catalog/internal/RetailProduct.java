package com.example.taskflow.catalog.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/**
 * A product the shop sells over the counter (V44). Display only: unlike a {@code ServiceItem} it
 * is never booked, so nothing references it and it can simply be deleted.
 */
@Entity
@Table(name = "retail_products")
public class RetailProduct {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    /** The pack size as the shop labels it ({@code 100ml}); optional. */
    @Column(name = "size_label", length = 30)
    private String sizeLabel;

    @Column(nullable = false)
    private BigDecimal price;

    /** Position in the list (ascending; ties by name). */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    public RetailProduct() {
    }

    public Long getId() { return id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getSizeLabel() { return sizeLabel; }
    public void setSizeLabel(String sizeLabel) { this.sizeLabel = sizeLabel; }

    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }

    public int getSortOrder() { return sortOrder; }
    public void setSortOrder(int sortOrder) { this.sortOrder = sortOrder; }
}
