package com.example.taskflow.catalog;

import com.example.taskflow.catalog.internal.ShopAnnouncement;
import com.example.taskflow.catalog.internal.ShopAnnouncementRepository;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reads and writes the single V45 row; every write invalidates the cached strip after commit. */
@Service
@Transactional
class ShopAnnouncementServiceImpl implements ShopAnnouncementService {

    private final ShopAnnouncementRepository repository;
    private final ApplicationEventPublisher events;

    ShopAnnouncementServiceImpl(ShopAnnouncementRepository repository, ApplicationEventPublisher events) {
        this.repository = repository;
        this.events = events;
    }

    @Override
    @Transactional(readOnly = true)
    @Cacheable(value = CatalogCacheConfig.ANNOUNCEMENT_CACHE, sync = true)
    public AnnouncementResponse current() {
        return AnnouncementResponse.of(repository
                .findById(ShopAnnouncement.ID)
                .map(ShopAnnouncement::getMessage)
                .orElse(null));
    }

    @Override
    public AnnouncementResponse update(AnnouncementRequest request) {
        String message = request.message() == null || request.message().isBlank()
                ? null
                : request.message().trim();
        ShopAnnouncement row = repository.findById(ShopAnnouncement.ID).orElseGet(() -> new ShopAnnouncement(null));
        row.setMessage(message);
        repository.save(row);
        events.publishEvent(new AnnouncementChangedEvent());
        return AnnouncementResponse.of(message);
    }
}
