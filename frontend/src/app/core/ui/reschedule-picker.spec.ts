import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import {
  DEFAULT_SHOP_RULES,
  DEFAULT_TIME_SLOTS,
  rescheduleDates,
  shopWallClock,
} from '@taskflow/domain';
import { ReschedulePicker } from './reschedule-picker';
import { ShopClock } from '../shop-clock';

/** The protected selection signals, which only a test reaches into. */
interface PickerInternals {
  selectedDate: WritableSignal<string>;
  selectedTime: WritableSignal<string>;
  dates: () => string[];
}

describe('ReschedulePicker', () => {
  let fixture: ComponentFixture<ReschedulePicker>;
  let picker: PickerInternals;
  let httpMock: HttpTestingController;
  let shopClock: ShopClock;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /**
   * Answers every availability lookup the resource starts (from an effect) and lets it settle. A
   * changed day re-keys the lookup, so answering one can start the next: drain until none is left.
   */
  const answerAvailability = async () => {
    for (let round = 0; round < 5; round++) {
      TestBed.tick();
      const pending = httpMock.match((req) => req.url.includes('/availability'));
      pending.forEach((req) => req.flush([]));
      if (pending.length === 0) break;
    }
    await fixture.whenStable();
  };

  const answerShopInfo = (rules = DEFAULT_SHOP_RULES) => {
    TestBed.tick();
    httpMock
      .match((req) => req.url.includes('/public/shop'))
      .forEach((req) => req.flush({ ...rules, timeZone: zone }));
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ReschedulePicker);
    fixture.componentRef.setInput('publicId', 'abc-1');
    httpMock = TestBed.inject(HttpTestingController);
    shopClock = TestBed.inject(ShopClock);
    fixture.detectChanges();
    answerShopInfo();
    await answerAvailability();
    picker = fixture.componentInstance as unknown as PickerInternals;
  });

  afterEach(async () => {
    await answerAvailability();
    httpMock.verify();
  });

  it('keeps the chosen day and time while the shop clock ticks', async () => {
    const days = rescheduleDates(shopWallClock(zone), DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS);
    expect(days.length).toBeGreaterThan(1);

    picker.selectedDate.set(days[1] as string);
    await answerAvailability();
    picker.selectedTime.set('13:00');

    // watch() ticks every minute and on every tab focus; confirm() ticks too. A tick must not
    // move the booking the customer is about to confirm.
    shopClock.tick();
    await fixture.whenStable();

    expect(picker.selectedDate()).toBe(days[1]);
    expect(picker.selectedTime()).toBe('13:00');
  });

  it('keeps the chosen day when the open days really change, while it is still open', async () => {
    const days = rescheduleDates(shopWallClock(zone), DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS);
    expect(days.length).toBeGreaterThan(2);

    picker.selectedDate.set(days[1] as string);
    await answerAvailability();

    // A shorter booking window (an admin changed it) genuinely shortens the list.
    shopClock.reload();
    answerShopInfo({ ...DEFAULT_SHOP_RULES, maxAdvanceDays: 2 });
    await answerAvailability();

    expect(picker.dates().length).toBeLessThan(days.length);
    expect(picker.selectedDate()).toBe(days[1]);
  });

  it('preselects the day the booking is on, or the first open one', () => {
    const days = rescheduleDates(shopWallClock(zone), DEFAULT_SHOP_RULES, DEFAULT_TIME_SLOTS);

    // No current date given in beforeEach: the first open day.
    expect(picker.selectedDate()).toBe(days[0]);
  });
});
