import React, { useCallback, useState, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRoute, RouteProp, useNavigation, CommonActions } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { TimeSlotPicker } from '../components/booking/TimeSlotPicker';
import { ReceiptModal } from '../components/booking/ReceiptModal';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { useCatalog } from '../hooks/useCatalog';
import { usePublicBarbers } from '../hooks/useBarbers';
import { useBusySlots, useCreateAppointment } from '../hooks/useAppointments';
import { GuestTabParamList, RootStackParamList } from '../types/navigation';
import { AppointmentItem } from '../types/api';
import { colors } from '../theme/colors';
import {
  DEFAULT_TIME_SLOTS,
  formatTime12Hour,
  computeEstimatedEndTime,
  getFirstSelectableSlot,
  getSlotValidationError,
  getUpcomingDays,
  isSlotInPast,
  resolveBookableSelection,
  toLocalDateString,
} from '../utils/time-utils';
import { getApiErrorMessage, getHttpStatus } from '../utils/errors';
import { useNow } from '../hooks/useNow';
import { AttemptKey, resolveAttemptKey } from '../utils/idempotency';

type RouteProps = RouteProp<GuestTabParamList, 'Booking'>;

type BookingNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Booking'>,
  NativeStackNavigationProp<RootStackParamList>
>;

/** Input-only sentinel (ADR-014): the backend resolves it to a concrete barber. */
export const NO_PREFERENCE_BARBER = 'No Preference (First Available)';

// Backend category values (V5__create_service_catalog.sql): hair | beard | combo
const CATEGORIES = ['all', 'hair', 'beard', 'combo'];

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  hair: 'Haircuts',
  beard: 'Beards & Shaves',
  combo: 'Combos',
};

/** Destination after the booking receipt closes.
 *
 * BookingScreen is mounted in BOTH the guest tab navigator (route 'Booking',
 * sibling 'Home') and the customer tab navigator (route 'NewBooking', no
 * 'Home' route). Navigating to 'Home' from the customer flow would crash with
 * "action 'NAVIGATE' with name 'Home' was not handled". Pure helper — the
 * current tab navigator's route names decide the target.
 */
export const getPostBookingDestination = (
  routeNames: readonly string[],
): 'Home' | 'CustomerAppointments' =>
  routeNames.includes('Home') ? 'Home' : 'CustomerAppointments';

export const BookingScreen: React.FC = () => {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<BookingNavProp>();

  const { data: services = [] } = useCatalog();
  const { data: apiBarbers = [] } = usePublicBarbers();
  const createMutation = useCreateAppointment();

  // Wall clock for slot filtering. Ticks every minute and when the app returns
  // to the foreground, so past slots disable themselves and a midnight
  // rollover re-bases the day list without a dedicated timer.
  const now = useNow();
  const todayKey = toLocalDateString(now);
  // The day list only depends on the calendar date, not on the minute, so it is rebuilt from
  // todayKey (noon: clear of DST shifts). Reading `now` here while depending on todayKey made
  // React Compiler give up on the whole screen.
  const upcomingDays = useMemo(() => {
    const [year = 0, month = 1, day = 1] = todayKey.split('-').map(Number);
    return getUpcomingDays(new Date(year, month - 1, day, 12));
  }, [todayKey]);
  const upcomingDates = useMemo(() => upcomingDays.map((d) => d.dateStr), [upcomingDays]);

  // Destination for the receipt close button (guest vs customer tab navigator)
  const postBookingDestination = useMemo(
    () =>
      getPostBookingDestination(
        navigation.getState?.()?.routes.map((r) => r.name) ?? [],
      ),
    [navigation],
  );

  // API-driven roster (mirrors the web PublicBarberStore): no hardcoded names
  // that can silently drift from the backend directory.
  const barberNames = useMemo(
    () => [NO_PREFERENCE_BARBER, ...apiBarbers.map((b) => b.name)],
    [apiBarbers],
  );

  // Service search & category state
  const [serviceSearchQuery, setServiceSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Form State
  const [step, setStep] = useState<number>(1);
  const [selectedBarber, setSelectedBarber] = useState<string>(
    route.params?.preselectedBarber || NO_PREFERENCE_BARBER
  );
  const [selectedService, setSelectedService] = useState<string>(
    route.params?.preselectedService || (services[0]?.name ?? 'Classic Haircut')
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    () => getFirstSelectableSlot(upcomingDates, now)?.date ?? upcomingDates[0] ?? ''
  );
  const [selectedTime, setSelectedTime] = useState<string>(
    () => getFirstSelectableSlot(upcomingDates, now)?.time ?? DEFAULT_TIME_SLOTS[0] ?? ''
  );

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [error, setError] = useState<string | null>(null);
  // The receipt keeps its own total: the wizard is reset the moment the
  // booking succeeds, so it cannot be derived from the (cleared) selection.
  const [receipt, setReceipt] = useState<{ appointment: AppointmentItem; total: number } | null>(
    null,
  );

  // Stable Idempotency-Key for the current booking attempt: retained across a
  // failed/ambiguous submit so a re-tap replays the original booking, and
  // rotated once the payload changes or the booking succeeds.
  const attemptKeyRef = useRef<AttemptKey | null>(null);

  // Busy slots. "No Preference" is passed through as the sentinel name: the
  // backend aggregates across all barbers, so the picker reflects real
  // availability instead of showing every slot free.
  const {
    data: busySlots = [],
    isLoading: checkingSlots,
    isError: busySlotsFailed,
    error: busySlotsError,
    refetch: refetchBusySlots,
  } = useBusySlots(selectedBarber, selectedDate, selectedService);

  // Filtered services
  const filteredServices = useMemo(() => {
    let list = services;
    if (selectedCategory !== 'all') {
      list = list.filter((s) => s.category === selectedCategory);
    }
    const query = serviceSearchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query),
      );
    }
    return list;
  }, [services, selectedCategory, serviceSearchQuery]);

  // Selected service object for pricing
  const selectedServiceObj = services.find((s) => s.name === selectedService);

  // Computed pricing. The backend does not model a platform fee, so the
  // summary and receipt show the catalog service price only (web parity).
  const checkoutTotal = selectedServiceObj?.price ?? 0;

  // Estimated end time
  const estimatedEnd = computeEstimatedEndTime(selectedTime, selectedServiceObj?.durationMinutes ?? 0);

  // Slots already in the past for the selected day (disabled in the picker).
  const pastSlots = useMemo(
    () => DEFAULT_TIME_SLOTS.filter((slot) => isSlotInPast(selectedDate, slot, now)),
    [selectedDate, now],
  );
  const noSlotsLeft = !!selectedDate && pastSlots.length === DEFAULT_TIME_SLOTS.length;

  // Keep a valid service selected once the catalog loads (never a hardcoded
  // name that may not exist, which left the summary showing $0.00).
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
    );
    if (next && (next.date !== selectedDate || next.time !== selectedTime)) {
      setSelectedDate(next.date);
      setSelectedTime(next.time);
    }
  }, [now, upcomingDates, selectedDate, selectedTime]);

  // Reset every wizard field to its starting value. The idempotency key is
  // deliberately NOT touched here: it is already cleared on success/409, and
  // keeping it across a blur preserves replay semantics for an ambiguous
  // timeout followed by an identical re-submission.
  const resetWizard = useCallback(() => {
    const first = getFirstSelectableSlot(upcomingDates, new Date());
    setStep(1);
    setSelectedBarber(NO_PREFERENCE_BARBER);
    setSelectedService(services[0]?.name ?? 'Classic Haircut');
    setSelectedDate(first?.date ?? upcomingDates[0] ?? '');
    setSelectedTime(first?.time ?? DEFAULT_TIME_SLOTS[0] ?? '');
    setCustomerName('');
    setCustomerEmail('');
    setCustomerPhone('');
    setServiceSearchQuery('');
    setSelectedCategory('all');
    setError(null);
  }, [services, upcomingDates]);

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

  const handleNextStep = () => {
    if (step === 1) {
      if (!selectedService) {
        setError('Please select a treatment.');
        return;
      }
      setError(null);
      setStep(2);
    } else if (step === 2) {
      if (!selectedBarber) {
        setError('Please select a barber.');
        return;
      }
      setError(null);
      setStep(3);
    } else if (step === 3) {
      const slotError = getSlotValidationError(selectedDate, selectedTime, new Date());
      if (slotError) {
        setError(slotError);
        return;
      }
      if (busySlotsFailed) {
        setError('Could not check availability. Retry before continuing.');
        return;
      }
      if (busySlots.includes(selectedTime)) {
        setError('The selected time slot is already booked. Please choose another.');
        return;
      }
      setError(null);
      setStep(4);
    }
  };

  const handleSubmitBooking = async () => {
    if (!customerName.trim() || !customerEmail.trim() || !customerPhone.trim()) {
      setError('Please fill in all customer contact fields.');
      return;
    }

    // The slot may have passed while the contact form was being filled in.
    const slotError = getSlotValidationError(selectedDate, selectedTime, new Date());
    if (slotError) {
      setError(slotError);
      setStep(3);
      return;
    }

    setError(null);

    const payload = {
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
      barberName: selectedBarber,
      bookingDate: selectedDate,
      bookingTime: selectedTime,
      serviceType: selectedService,
    };
    const attempt = resolveAttemptKey(attemptKeyRef.current, JSON.stringify(payload));
    attemptKeyRef.current = attempt;

    try {
      const result = await createMutation.mutateAsync({
        data: payload,
        idempotencyKey: attempt.key,
      });

      attemptKeyRef.current = null;
      setReceipt({ appointment: result, total: checkoutTotal });
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

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* iOS does not resize the window for the keyboard: inset the content so the step 4 fields
          and the submit button can be scrolled above it, and let taps through while it is open. */}
      <ScrollView
        testID="booking-scroll-view"
        contentContainerStyle={styles.scrollContent}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {/* Wizard Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Booking Assistant</Text>
          <Text style={styles.subtitle}>Follow our step-by-step assistant to secure your slot</Text>

          {/* Step Timeline */}
          <View style={styles.stepTimeline}>
            <View style={styles.timelineBg} />
            <View style={[styles.timelineProgress, { width: `${((step - 1) / 3) * 100}%` }]} />
            <View style={styles.stepNodes}>
              {[1, 2, 3, 4].map((s) => {
                const isActive = step === s;
                const isCompleted = step > s;
                return (
                  <View
                    key={s}
                    style={[
                      styles.stepNode,
                      isActive && styles.stepNodeActive,
                      isCompleted && styles.stepNodeCompleted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepNodeText,
                        isActive && styles.stepNodeTextActive,
                        isCompleted && styles.stepNodeTextCompleted,
                      ]}
                    >
                      {isCompleted ? '✓' : s}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Step label */}
          <Text style={styles.stepLabel}>
            {step === 1 ? '1. Select Treatment' :
             step === 2 ? '2. Choose Your Stylist' :
             step === 3 ? '3. Pick Date & Available Slot' :
             '4. Customer Info & Submit'}
          </Text>
        </View>

        <ErrorMessage message={error || ''} />

        {/* STEP 1: SERVICE SELECTION */}
        {step === 1 && (
          <View>
            {/* Service Search */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={16} color={colors.text.muted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search treatments (fade, trim, shave)..."
                placeholderTextColor={colors.text.muted}
                value={serviceSearchQuery}
                onChangeText={setServiceSearchQuery}
              />
            </View>

            {/* Category Tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
              {CATEGORIES.map((cat) => {
                const isSel = selectedCategory === cat;
                const displayLabel = CATEGORY_LABELS[cat] ?? cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, isSel && styles.catChipSelected]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text style={[styles.catText, isSel && styles.catTextSelected]}>
                      {displayLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Choose Service</Text>
            {filteredServices.map((svc) => {
              const isSel = selectedService === svc.name;
              return (
                <TouchableOpacity
                  key={svc.id}
                  style={[styles.optionCard, isSel && styles.optionSelected]}
                  onPress={() => setSelectedService(svc.name)}
                >
                  <View style={styles.optionInfo}>
                    <View style={styles.optionRow}>
                      {isSel && <Text style={styles.crownIcon}>👑</Text>}
                      <Text style={styles.optionTitle}>{svc.name}</Text>
                    </View>
                    <Text style={styles.optionSub}>Duration: {svc.durationMinutes} mins</Text>
                    <Text style={styles.optionDesc}>{svc.description}</Text>
                  </View>
                  <Text style={styles.optionPrice}>${svc.price.toFixed(2)}</Text>
                </TouchableOpacity>
              );
            })}

            <Button
              title="Continue to Stylist"
              variant="primary"
              size="lg"
              onPress={handleNextStep}
              style={{ marginTop: 24 }}
            />
          </View>
        )}

        {/* STEP 2: CHOOSE YOUR STYLIST */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>2. Choose Your Stylist</Text>

            <Text style={styles.label}>Select Barber</Text>
            {barberNames.map((b) => {
              const isSel = selectedBarber === b;
              return (
                <TouchableOpacity
                  key={b}
                  style={[styles.optionCard, isSel && styles.optionSelected]}
                  onPress={() => setSelectedBarber(b)}
                >
                  <Ionicons
                    name="person"
                    size={20}
                    color={isSel ? colors.gold.main : colors.text.muted}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={[styles.optionTitle, { flex: 1 }]}>{b}</Text>
                  {isSel && <Ionicons name="checkmark-circle" size={20} color={colors.gold.main} />}
                </TouchableOpacity>
              );
            })}

            <View style={styles.navRow}>
              <Button title="Back" variant="secondary" onPress={() => setStep(1)} style={styles.halfBtn} />
              <Button title="Continue" variant="primary" onPress={handleNextStep} style={styles.halfBtn} />
            </View>
          </View>
        )}

        {/* STEP 3: DATE & TIME */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>3. Pick Date & Available Slot</Text>

            <Text style={styles.label}>Select Operating Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.daysScroll}>
              {upcomingDays.map((d) => {
                const isSel = selectedDate === d.dateStr;
                return (
                  <TouchableOpacity
                    key={d.dateStr}
                    style={[styles.dayCard, isSel && styles.daySelected]}
                    onPress={() => setSelectedDate(d.dateStr)}
                  >
                    <Text style={[styles.dayName, isSel && styles.dayTextSel]}>{d.dayName}</Text>
                    <Text style={[styles.dayNum, isSel && styles.dayTextSel]}>{d.dayNum}</Text>
                    <Text style={[styles.monthName, isSel && styles.dayTextSel]}>{d.monthName}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.label, { marginTop: 20 }]}>Available Time Slots</Text>
            {checkingSlots ? (
              <View style={styles.checkingContainer}>
                <ActivityIndicator size="large" color={colors.gold.main} />
                <Text style={styles.checkingText}>Checking slot availability...</Text>
              </View>
            ) : busySlotsFailed ? (
              <View style={styles.noDatePrompt}>
                <Text style={styles.noDateText}>
                  {getApiErrorMessage(busySlotsError, 'Could not check availability.')}
                </Text>
                <Button
                  title="Retry"
                  variant="secondary"
                  size="sm"
                  onPress={() => refetchBusySlots()}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : selectedDate ? (
              <>
                <TimeSlotPicker
                  slots={DEFAULT_TIME_SLOTS}
                  selectedSlot={selectedTime}
                  busySlots={busySlots}
                  pastSlots={pastSlots}
                  onSelectSlot={setSelectedTime}
                />
                {noSlotsLeft && (
                  <Text style={styles.noDateText}>
                    No more slots are available on this day. Please pick another date.
                  </Text>
                )}
              </>
            ) : (
              <View style={styles.noDatePrompt}>
                <Text style={styles.noDateText}>📅 Select an upcoming date above to view available time slots</Text>
              </View>
            )}

            <View style={styles.navRow}>
              <Button title="Back" variant="secondary" onPress={() => setStep(2)} style={styles.halfBtn} />
              <Button title="Continue" variant="primary" onPress={handleNextStep} style={styles.halfBtn} />
            </View>
          </View>
        )}

        {/* STEP 4: CUSTOMER DETAILS & CONFIRM */}
        {step === 4 && (
          <View>
            <Text style={styles.stepTitle}>4. Contact Details & Summary</Text>

            {/* Summary Card */}
            <Card style={styles.summaryCard} variant="goldBorder">
              <Text style={styles.summaryTitle}>Reservation Summary</Text>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Treatment:</Text>
                <Text style={styles.summaryVal}>{selectedService}</Text>
              </View>
              {selectedServiceObj && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Duration:</Text>
                  <Text style={styles.summaryVal}>{selectedServiceObj.durationMinutes} mins</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Barber:</Text>
                <Text style={styles.summaryVal}>{selectedBarber}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Date & Time:</Text>
                <Text style={styles.summaryVal}>
                  {selectedDate} @ {formatTime12Hour(selectedTime)}
                </Text>
              </View>
              {estimatedEnd ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Est. End Time:</Text>
                  <Text style={styles.estEndVal}>{formatTime12Hour(estimatedEnd)}</Text>
                </View>
              ) : null}

              <View style={styles.divider} />

              <View style={[styles.summaryRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total Est. Price:</Text>
                <Text style={styles.totalPrice}>${checkoutTotal.toFixed(2)}</Text>
              </View>
            </Card>

            <Input
              label="Full Name *"
              placeholder="e.g. John Doe"
              value={customerName}
              onChangeText={setCustomerName}
              testID="customer-name-input"
            />

            <Input
              label="Email Address *"
              placeholder="john.doe@example.com"
              value={customerEmail}
              onChangeText={setCustomerEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              testID="customer-email-input"
            />

            <Input
              label="Phone Number *"
              placeholder="+1 (555) 000-0000"
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
              testID="customer-phone-input"
            />

            <View style={styles.navRow}>
              <Button title="Back" variant="secondary" onPress={() => setStep(3)} style={styles.halfBtn} />
              <Button
                title="Confirm & Request Booking"
                variant="primary"
                loading={createMutation.isPending}
                onPress={handleSubmitBooking}
                style={styles.halfBtn}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Confirmation Receipt Modal */}
      <ReceiptModal
        visible={!!receipt}
        appointment={receipt?.appointment ?? null}
        checkoutTotal={receipt?.total ?? 0}
        onClose={() => {
          setReceipt(null);
          navigation.dispatch(
            CommonActions.navigate({ name: postBookingDestination }),
          );
        }}
        onOpenPublicActions={(publicId) => {
          setReceipt(null);
          navigation.navigate('PublicActions', { publicId });
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: colors.text.primary,
    fontSize: 22,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 2,
  },
  // Step Timeline
  stepTimeline: {
    position: 'relative',
    height: 36,
    marginTop: 16,
    marginBottom: 8,
  },
  timelineBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 16,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 2,
  },
  timelineProgress: {
    position: 'absolute',
    left: 0,
    top: 16,
    height: 3,
    backgroundColor: colors.gold.dark,
    borderRadius: 2,
    zIndex: 1,
  },
  stepNodes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'relative',
    zIndex: 2,
  },
  stepNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    backgroundColor: colors.obsidian.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNodeActive: {
    borderColor: colors.gold.main,
    backgroundColor: colors.obsidian.card,
  },
  // Mirrors the web stepper: a gold fill with a dark check mark (gold on gold.dark was 1.7:1).
  stepNodeCompleted: {
    borderColor: colors.gold.main,
    backgroundColor: colors.gold.main,
  },
  stepNodeText: {
    color: colors.text.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  stepNodeTextActive: {
    color: colors.gold.main,
  },
  stepNodeTextCompleted: {
    color: colors.text.dark,
  },
  stepLabel: {
    textAlign: 'center',
    color: colors.gold.main,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  stepTitle: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 13,
    paddingVertical: 10,
  },
  // Category Tabs
  catScroll: {
    maxHeight: 36,
    marginBottom: 16,
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginRight: 6,
  },
  catChipSelected: {
    backgroundColor: colors.obsidian.card,
    borderColor: colors.gold.main,
  },
  catText: {
    color: colors.text.secondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  catTextSelected: {
    color: colors.gold.main,
  },
  label: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.obsidian.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    padding: 14,
    marginBottom: 8,
  },
  optionSelected: {
    borderColor: colors.gold.main,
    backgroundColor: colors.obsidian.surface,
  },
  optionInfo: {
    flex: 1,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  crownIcon: {
    fontSize: 14,
  },
  optionTitle: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  optionSub: {
    color: colors.text.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  optionDesc: {
    color: colors.text.secondary,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  optionPrice: {
    color: colors.gold.main,
    fontSize: 15,
    fontWeight: '800',
  },
  // Days
  daysScroll: {
    marginBottom: 12,
  },
  dayCard: {
    width: 68,
    height: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
    backgroundColor: colors.obsidian.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  daySelected: {
    backgroundColor: colors.gold.main,
    borderColor: colors.gold.main,
  },
  dayName: {
    color: colors.text.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  dayNum: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '800',
    marginVertical: 2,
  },
  monthName: {
    color: colors.text.muted,
    fontSize: 10,
  },
  dayTextSel: {
    color: colors.obsidian.bg,
  },
  // Checking indicator
  checkingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  checkingText: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  noDatePrompt: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  noDateText: {
    color: colors.text.muted,
    fontSize: 13,
  },
  // Navigation
  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  halfBtn: {
    flex: 1,
  },
  // Summary
  summaryCard: {
    marginBottom: 16,
  },
  summaryTitle: {
    color: colors.gold.main,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  summaryLabel: {
    color: colors.text.muted,
    fontSize: 13,
  },
  summaryVal: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  estEndVal: {
    color: colors.gold.main,
    fontSize: 13,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },
  priceVal: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '600',
  },
  totalRow: {
    marginTop: 4,
  },
  totalLabel: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  totalPrice: {
    color: colors.gold.bright,
    fontSize: 16,
    fontWeight: '800',
  },
});
