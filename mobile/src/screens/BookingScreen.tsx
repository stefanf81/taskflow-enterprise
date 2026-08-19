import React, { useState, useEffect, useMemo } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
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
  formatTime12Hour,
  computeEstimatedEndTime,
  getUpcomingDays,
  toLocalDateString,
} from '../utils/time-utils';

type RouteProps = RouteProp<GuestTabParamList, 'Booking'>;

type BookingNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Booking'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const BARBERS_FALLBACK = [
  'No Preference (First Available)',
  'Alex the Barber',
  'Sara the Stylist',
  'Marcus Master Blade',
];

const TIME_SLOTS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

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

  // Recompute the day list when the local calendar date rolls over at midnight
  // (memo dep on todayKey, not the effect itself). Drift-free: the timeout is
  // scheduled to the next local midnight and re-armed on every rollover.
  const [todayKey, setTodayKey] = useState(() => toLocalDateString(new Date()));
  const upcomingDays = useMemo(() => getUpcomingDays(new Date()), [todayKey]);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0,
    );
    const timer = setTimeout(() => {
      setTodayKey(toLocalDateString(new Date()));
    }, nextMidnight.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [todayKey]);

  // Destination for the receipt close button (guest vs customer tab navigator)
  const postBookingDestination = useMemo(
    () =>
      getPostBookingDestination(
        navigation.getState?.()?.routes.map((r) => r.name) ?? [],
      ),
    [navigation],
  );

  // Build barber list from API, fallback to static names
  const barberNames = apiBarbers.length > 0
    ? ['No Preference (First Available)', ...apiBarbers.map((b) => b.name)]
    : BARBERS_FALLBACK;

  // Service search & category state
  const [serviceSearchQuery, setServiceSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Form State
  const [step, setStep] = useState<number>(1);
  const [selectedBarber, setSelectedBarber] = useState<string>(
    route.params?.preselectedBarber || barberNames[0]
  );
  const [selectedService, setSelectedService] = useState<string>(
    route.params?.preselectedService || (services[0]?.name ?? 'Classic Haircut')
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    upcomingDays[0]?.dateStr || ''
  );
  const [selectedTime, setSelectedTime] = useState<string>('09:00');

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [receiptAppointment, setReceiptAppointment] = useState<AppointmentItem | null>(null);

  // Real-time busy slots query — when "No Preference" is selected, show no busy indicators
  // since the backend will assign the first available barber automatically
  const effectiveBarber =
    selectedBarber === 'No Preference (First Available)' ? '' : selectedBarber;
  const { data: busySlots = [], isLoading: checkingSlots } = useBusySlots(
    effectiveBarber,
    selectedDate
  );

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

  // Computed pricing
  const checkoutSubtotal = selectedServiceObj?.price ?? 0;
  const checkoutFee = 2.5;
  const checkoutTotal = checkoutSubtotal + checkoutFee;

  // Estimated end time
  const estimatedEnd = computeEstimatedEndTime(selectedTime, selectedServiceObj?.durationMinutes ?? 0);

  // Keep a valid service selected once the catalog loads:
  // - honor a route-preselected service only if it exists in the catalog
  // - otherwise fall back to the first catalog entry (never a hardcoded name
  //   that may not exist, which left the summary showing $0.00)
  useEffect(() => {
    if (services.length === 0) return;
    const preselected = route.params?.preselectedService;
    const candidate =
      preselected && services.some((s) => s.name === preselected)
        ? preselected
        : services[0].name;
    setSelectedService((current) =>
      current && services.some((s) => s.name === current) ? current : candidate,
    );
  }, [services, route.params?.preselectedService]);

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
      if (!selectedDate || !selectedTime) {
        setError('Please select a date and time slot.');
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

    setError(null);
    try {
      const result = await createMutation.mutateAsync({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        barberName: selectedBarber,
        bookingDate: selectedDate,
        bookingTime: selectedTime,
        serviceType: selectedService,
      });

      setReceiptAppointment(result);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : err instanceof Error
            ? err.message
            : 'Failed to submit booking.';
      setError(message || 'Failed to submit booking.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView testID="booking-scroll-view" contentContainerStyle={styles.scrollContent}>
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
                        (isActive || isCompleted) && styles.stepNodeTextActive,
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
            ) : selectedDate ? (
              <TimeSlotPicker
                slots={TIME_SLOTS}
                selectedSlot={selectedTime}
                busySlots={busySlots}
                onSelectSlot={setSelectedTime}
              />
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

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal:</Text>
                <Text style={styles.priceVal}>${checkoutSubtotal.toFixed(2)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Platform Svc Fee:</Text>
                <Text style={styles.priceVal}>${checkoutFee.toFixed(2)}</Text>
              </View>
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
        visible={!!receiptAppointment}
        appointment={receiptAppointment}
        checkoutTotal={checkoutTotal}
        onClose={() => {
          setReceiptAppointment(null);
          navigation.dispatch(
            CommonActions.navigate({ name: postBookingDestination }),
          );
        }}
        onOpenPublicActions={(publicId) => {
          setReceiptAppointment(null);
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
  stepNodeCompleted: {
    borderColor: colors.gold.dark,
    backgroundColor: colors.gold.dark,
  },
  stepNodeText: {
    color: colors.text.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  stepNodeTextActive: {
    color: colors.gold.main,
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
