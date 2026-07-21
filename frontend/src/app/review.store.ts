import { Injectable, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { BarberRating } from './appointment.service';

@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly ratingsResource = httpResource<BarberRating[]>(
    () => '/api/v1/reviews/public/barber-ratings',
    {
      defaultValue: [],
    },
  );

  readonly ratings = this.ratingsResource.value;
  readonly isLoading = this.ratingsResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.ratingsResource.error();
    return err ? 'Could not load barber ratings.' : null;
  });

  loadRatings(): void {
    this.ratingsResource.reload();
  }
}
