package com.example.taskflow.catalog.internal;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ShopAnnouncementRepository extends JpaRepository<ShopAnnouncement, Short> {}
