package com.example.taskflow.catalog;

import jakarta.persistence.*;
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;
import java.math.BigDecimal;

@Entity
@Table(name = "services")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "l2-services")
public class ServiceItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false)
    private BigDecimal price;

    @Column(nullable = false)
    private Integer durationMinutes;

    @Column(nullable = false, length = 50)
    private String category;

    @Column(length = 500)
    private String description;

    /**
     * {@code false} once the service has been retired: it still has appointments that reference it,
     * so it cannot be deleted, but it must no longer be listed or bookable. Never exposed in the API.
     */
    @Column(nullable = false)
    private boolean active = true;

    public ServiceItem() {
    }

    public ServiceItem(String name, BigDecimal price, Integer durationMinutes, String category, String description) {
        this.name = name;
        this.price = price;
        this.durationMinutes = durationMinutes;
        this.category = category;
        this.description = description;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    
    public Integer getDurationMinutes() { return durationMinutes; }
    public void setDurationMinutes(Integer durationMinutes) { this.durationMinutes = durationMinutes; }
    
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
}
