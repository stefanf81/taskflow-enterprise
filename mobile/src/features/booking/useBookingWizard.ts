import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCatalog } from '../../core/catalog/useCatalog';
import { usePublicBarbers } from '../../core/barbers/useBarbers';
import { useBusySlots, useCreateAppointment } from '../../core/appointments/useAppointments';
import { GuestTabParamList, RootStackParamList } from '../../types/navigation';
import { AppointmentItem } from '../../types/api';
import {
  computeEstimatedEndTime,
  DEFAULT_TIME_SLOTS,
  getSlotValidationError,
  resolveBookableSelection,
  shopWallClock,
  toLocalDateString,
} from '../../utils/time-utils';
import { getApiErrorMessage, getHttpStatus } from '../../utils/errors';
import { useNow } from './useNow';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { AttemptKey, resolveAttemptKey } from './idempotency';
import {
  BookingStep,
  BookingSummary,
  buildBookingPayload,
  ContactDetails,
  DATE_TIME_STEP,
  EMPTY_CONTACT,
  getBookingDays,
  getContactError,
  getDateTimeStepError,
  getDefaultSlot,
  getPastSlots,
  NO_PREFERENCE_BARBER,
  SlotAvailability,
} from './bookingWizard';

type BookingRouteProp = RouteProp<GuestTabParamList, 'Booking'>;

export type BookingNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Booking'>,
  NativeStackNavigationProp<RootStackParamList>
>;

/**
 * The receipt keeps its own total: the wizard is reset the moment the booking succeeds, so it
 * cannot be derived from the (cleared) selection.
 */
export interface BookingReceipt {
  appointment: AppointmentItem;
  total: number;
}

/**
 * State and rules of the four-step booking wizard: the selection, step validation, the
 * Idempotency-Key of the current attempt and the submission. The step components only render
 * what this returns; BookingScreen composes them.
 */
export function useBookingWizard() {
  const route = useRoute<BookingRouteProp>();
  const navigation = useNavigation<BookingNavProp>();

  const {
    data: services = [],
    isLoading: catalogLoading,
    isError: catalogError,
    refetch: refetchCatalog,
  } = useCatalog();
  const { data: apiBarbers = [] } = usePublicBarbers();
  const createMutation = useCreateAppointment();

  // Wall clock for slot filtering. Ticks every minute and when the app returns
  // to the foreground, so past slots disable themselves and a midnight
  // rollover re-bases the day list without a dedicated timer.
  // Dates and the past-slot rule follow the shop's time zone, as the server's do.
  const { timeZone: shopTimeZone, rules: shopRules } = useShopInfo();
  const now = useNow(60_000, shopTimeZone);
  const todayKey = toLocalDateString(now);
  // Rebuilt from todayKey only. Reading `now` here while depending on todayKey made React
  // Compiler give up on the whole screen.
  // The opening days and booking window come from the shop info (server defaults until loaded).
  const upcomingDays = useMemo(() => getBookingDays(todayKey, shopRules), [todayKey, shopRules]);
  const upcomingDates = useMemo(() => upcomingDays.map((d) => d.dateStr), [upcomingDays]);

  // API-driven roster (mirrors the web PublicBarberStore): no hardcoded names
  // that can silently drift from the backend directory.
  const barberNames = useMemo(
    () => [NO_PREFERENCE_BARBER, ...apiBarbers.map((b) => b.name)],
    [apiBarbers],
  );

  // Service search & category state
  const [serviceSearchQuery, setServiceSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Form State. Until the catalog loads no service is selected: never a hardcoded name that may
  // not exist (it priced the summary at $0.00 and was sent to the busy-slots lookup).
  const [step, setStep] = useState<BookingStep>(1);
  const [selectedBarber, setSelectedBarber] = useState<string>(
    route.params?.preselectedBarber || NO_PREFERENCE_BARBER,
  );
  const [selectedService, setSelectedService] = useState<string>(
    route.params?.preselectedService || (services[0]?.name ?? ''),
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    () => getDefaultSlot(upcomingDates, now, shopRules).date,
  );
  const [selectedTime, setSelectedTime] = useState<string>(
    () => getDefaultSlot(upcomingDates, now, shopRules).time,
  );
  const [contact, setContact] = useState<ContactDetails>(EMPTY_CONTACT);

  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);

  // Stable Idempotency-Key for the current booking attempt: retained across a
  // failed/ambiguous submit so a re-tap replays the original booking, and
  // rotated once the payload changes or the booking succeeds.
  const attemptKeyRef = useRef<AttemptKey | null>(null);

  // Selected service object for pricing; undefined until it is a real catalog entry.
  const selectedServiceObj = services.find((s) => s.name === selectedService);

  // Busy slots. "No Preference" is passed through as the sentinel name: the
  // backend aggregates across all barbers, so the picker reflects real
  // availability instead of showing every slot free. Fetched only from the
  // date/time step on and for a catalog service: a service tap on step 1 must
  // not fire a lookup nobody sees.
  const {
    data: busySlots = [],
    isLoading: checkingSlots,
    isError: busySlotsFailed,
    error: busySlotsError,
    refetch: refetchBusySlots,
  } = useBusySlots(selectedBarber, selectedDate, selectedService, {
    enabled: step >= DATE_TIME_STEP && selectedServiceObj !== undefined,
  });
  const availability: SlotAvailability = {
    busySlots,
    isChecking: checkingSlots,
    isFailed: busySlotsFailed,
  };

  // Slots of the selected day that already started (disabled in the picker).
  const pastSlots = getPastSlots(selectedDate, now);
  const summary: BookingSummary = {
    service: selectedService,
    durationMinutes: selectedServiceObj?.durationMinutes,
    barber: selectedBarber,
    date: selectedDate,
    time: selectedTime,
    estimatedEnd: computeEstimatedEndTime(selectedTime, selectedServiceObj?.durationMinutes ?? 0),
    // The backend does not model a platform fee, so the summary and receipt
    // show the catalog service price only (web parity).
    total: selectedServiceObj?.price ?? 0,
  };

  // Keep a valid service selected once the catalog loads.
  useEffect(() => {
    if (services.length === 0) return;
    setSelectedService((current) =>
      current && services.some((s) => s.name === current) ? current : services[0].name,
    );
  }, [services]);

  // Keep the barber valid against the live roster.
  useEffect(() => {
    if (apiBarbers.length === 0) return;
    setSelectedBarber((current) => (barberNames.includes(current) ? current : NO_PREFERENCE_BARBER));
  }, [apiBarbers, barberNames]);

  // Re-validate the date/time pair as the clock moves (a slot passes, the day
  // rolls over at midnight): move to the nearest bookable slot instead of
  // leaving a stale, unbookable selection.
  useEffect(() => {
    const next = resolveBookableSelection(
      { date: selectedDate, time: selectedTime },
      upcomingDates,
      now,
      DEFAULT_TIME_SLOTS,
      shopRules,
    );
    if (next && (next.date !== selectedDate || next.time !== selectedTime)) {
      setSelectedDate(next.date);
      setSelectedTime(next.time);
    }
  }, [now, upcomingDates, selectedDate, selectedTime, shopRules]);

  // Reset every wizard field to its starting value. The idempotency key is
  // deliberately NOT touched here: it is already cleared on success/409, and
  // keeping it across a blur preserves replay semantics for an ambiguous
  // timeout followed by an identical re-submission.
  const resetWizard = () => {
    const first = getDefaultSlot(upcomingDates, shopWallClock(shopTimeZone), shopRules);
    setStep(1);
    setSelectedBarber(NO_PREFERENCE_BARBER);
    setSelectedService(services[0]?.name ?? '');
    setSelectedDate(first.date);
    setSelectedTime(first.time);
    setContact(EMPTY_CONTACT);
    setServiceSearchQuery('');
    setSelectedCategory('all');
    setError(null);
  };

  // The tab stays mounted while another tab/screen is shown, so leaving the
  // wizard (blur) must discard in-progress state or it would reappear stale.
  // An effect event always sees the latest resetWizard without re-subscribing (writing it to a
  // ref during render made React Compiler skip the screen).
  const onBlur = useEffectEvent(() => resetWizard());
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => onBlur());
    return unsubscribe;
  }, [navigation]);

  // Apply navigation params (Catalog "Book", stylist cards). Keyed on the
  // params object so re-navigating with new, or identical, params takes
  // effect; the params are consumed afterwards so a later reset or re-visit
  // does not re-apply stale preselections.
  const params = route.params;
  useEffect(() => {
    if (!params?.preselectedBarber && !params?.preselectedService) return;
    if (
      params.preselectedService &&
      (services.length === 0 || services.some((s) => s.name === params.preselectedService))
    ) {
      setSelectedService(params.preselectedService);
    }
    if (
      params.preselectedBarber &&
      (apiBarbers.length === 0 || barberNames.includes(params.preselectedBarber))
    ) {
      setSelectedBarber(params.preselectedBarber);
    }
    setStep(1);
    setError(null);
    navigation.setParams({ preselectedBarber: undefined, preselectedService: undefined });
    // services/apiBarbers are read for validation only; the effect must fire
    // on new params, not on every catalog refresh.
  }, [params]);

  const getStepError = (): string | null => {
    if (step === 1) return selectedServiceObj ? null : 'Please select a treatment.';
    if (step === 2) return selectedBarber ? null : 'Please select a barber.';
    // The clock as of this tap: the selected slot may have passed since the last tick.
    return getDateTimeStepError(
      selectedDate,
      selectedTime,
      shopWallClock(shopTimeZone),
      availability,
      shopRules,
    );
  };

  const goToNextStep = () => {
    if (step >= 4) return;
    const stepError = getStepError();
    setError(stepError);
    if (!stepError) setStep((step + 1) as BookingStep);
  };

  const goToPreviousStep = () => {
    if (step > 1) setStep((step - 1) as BookingStep);
  };

  const setContactField = (field: keyof ContactDetails, value: string) =>
    setContact((current) => ({ ...current, [field]: value }));

  const submitBooking = async () => {
    const contactError = getContactError(contact);
    if (contactError) {
      setError(contactError);
      return;
    }

    // The slot may have passed while the contact form was being filled in.
    const slotError = getSlotValidationError(
      selectedDate,
      selectedTime,
      shopWallClock(shopTimeZone),
      shopRules,
    );
    if (slotError) {
      setError(slotError);
      setStep(DATE_TIME_STEP);
      return;
    }

    setError(null);

    const payload = buildBookingPayload(contact, {
      barber: selectedBarber,
      date: selectedDate,
      time: selectedTime,
      service: selectedService,
    });
    const attempt = resolveAttemptKey(attemptKeyRef.current, JSON.stringify(payload));
    attemptKeyRef.current = attempt;

    try {
      const result = await createMutation.mutateAsync({
        data: payload,
        idempotencyKey: attempt.key,
      });

      attemptKeyRef.current = null;
      setReceipt({ appointment: result, total: summary.total });
      resetWizard();
    } catch (err: unknown) {
      // A 409 means the key was already used for a different payload; the next
      // attempt must use a fresh key.
      if (getHttpStatus(err) === 409) {
        attemptKeyRef.current = null;
      }
      // Surfaces the server rule message (past time, >90 days, off-grid hour,
      // max 5 active bookings per email, conflicts, ...).
      setError(getApiErrorMessage(err, 'Failed to submit booking.'));
    }
  };

  return {
    step,
    error,
    goToNextStep,
    goToPreviousStep,

    // Step 1: treatment
    services,
    catalogLoading,
    // A failed background refetch keeps the services already shown; only an empty catalog is an error.
    catalogFailed: catalogError && services.length === 0,
    retryCatalog: () => {
      refetchCatalog();
    },
    serviceSearchQuery,
    setServiceSearchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedService,
    setSelectedService,

    // Step 2: stylist
    barberNames,
    selectedBarber,
    setSelectedBarber,

    // Step 3: date and slot
    upcomingDays,
    selectedDate,
    setSelectedDate,
    selectedTime,
    setSelectedTime,
    pastSlots,
    noSlotsLeft: !!selectedDate && pastSlots.length === DEFAULT_TIME_SLOTS.length,
    availability,
    availabilityError: busySlotsError,
    retryAvailability: () => {
      refetchBusySlots();
    },

    // Step 4: contact and summary
    contact,
    setContactField,
    summary,
    isSubmitting: createMutation.isPending,
    submitBooking,

    receipt,
    clearReceipt: () => setReceipt(null),
  };
}

export type BookingWizard = ReturnType<typeof useBookingWizard>;
