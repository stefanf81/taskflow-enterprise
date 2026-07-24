import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
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
import { useBarbers } from '../hooks/useBarbers';
import { useBusySlots, useCreateAppointment } from '../hooks/useAppointments';
import { GuestTabParamList, RootStackParamList } from '../types/navigation';
import { AppointmentItem } from '../types/api';
import { colors } from '../theme/colors';

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

// Compute next 7 working days (excluding Sundays)
const getUpcomingDays = () => {
  const days = [];
  const today = new Date();
  let count = 0;
  let offset = 0;

  while (count < 7 && offset < 14) {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + offset);

    if (nextDate.getDay() !== 0) {
      // Skip Sundays
      const dateStr = nextDate.toISOString().split('T')[0];
      days.push({
        dateStr,
        dayName: nextDate.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: nextDate.getDate(),
        monthName: nextDate.toLocaleDateString('en-US', { month: 'short' }),
      });
      count++;
    }
    offset++;
  }
  return days;
};

export const BookingScreen: React.FC = () => {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<BookingNavProp>();

  const { data: services = [] } = useCatalog();
  const { data: apiBarbers = [] } = useBarbers();
  const createMutation = useCreateAppointment();

  const upcomingDays = getUpcomingDays();

  // Build barber list from API, fallback to static names
  const barberNames = apiBarbers.length > 0
    ? ['No Preference (First Available)', ...apiBarbers.map((b) => b.name)]
    : BARBERS_FALLBACK;

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

  // Real-time busy slots query
  const { data: busySlots = [] } = useBusySlots(selectedBarber, selectedDate);

  useEffect(() => {
    if (services.length > 0 && !selectedService) {
      setSelectedService(services[0].name);
    }
  }, [services]);

  const handleNextStep = () => {
    if (step === 1) {
      if (!selectedService || !selectedBarber) {
        setError('Please select a service and a barber.');
        return;
      }
      setError(null);
      setStep(2);
    } else if (step === 2) {
      if (!selectedDate || !selectedTime) {
        setError('Please select a date and time slot.');
        return;
      }
      if (busySlots.includes(selectedTime)) {
        setError('The selected time slot is already booked. Please choose another.');
        return;
      }
      setError(null);
      setStep(3);
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

  const selectedServiceObj = services.find((s) => s.name === selectedService);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Wizard Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Book Appointment</Text>
          <Text style={styles.subtitle}>Step {step} of 3</Text>

          {/* Step Indicator */}
          <View style={styles.stepBar}>
            {[1, 2, 3].map((s) => (
              <View
                key={s}
                style={[
                  styles.stepSegment,
                  s <= step && styles.stepActive,
                ]}
              />
            ))}
          </View>
        </View>

        <ErrorMessage message={error || ''} />

        {/* STEP 1: SERVICE & BARBER */}
        {step === 1 && (
          <View>
            <Text style={styles.stepTitle}>1. Select Service & Barber</Text>

            <Text style={styles.label}>Choose Service</Text>
            {services.map((svc) => {
              const isSel = selectedService === svc.name;
              return (
                <TouchableOpacity
                  key={svc.id}
                  style={[styles.optionCard, isSel && styles.optionSelected]}
                  onPress={() => setSelectedService(svc.name)}
                >
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>{svc.name}</Text>
                    <Text style={styles.optionSub}>{svc.durationMinutes} mins</Text>
                  </View>
                  <Text style={styles.optionPrice}>${svc.price.toFixed(2)}</Text>
                </TouchableOpacity>
              );
            })}

            <Text style={[styles.label, { marginTop: 20 }]}>Select Barber</Text>
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

            <Button
              title="Continue to Date & Time"
              variant="primary"
              size="lg"
              onPress={handleNextStep}
              style={{ marginTop: 24 }}
            />
          </View>
        )}

        {/* STEP 2: DATE & TIME */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>2. Select Date & Time</Text>

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
            <TimeSlotPicker
              slots={TIME_SLOTS}
              selectedSlot={selectedTime}
              busySlots={busySlots}
              onSelectSlot={setSelectedTime}
            />

            <View style={styles.navRow}>
              <Button title="Back" variant="secondary" onPress={() => setStep(1)} style={styles.halfBtn} />
              <Button title="Continue" variant="primary" onPress={handleNextStep} style={styles.halfBtn} />
            </View>
          </View>
        )}

        {/* STEP 3: CUSTOMER DETAILS & CONFIRM */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>3. Contact Details & Summary</Text>

            {/* Summary Card */}
            <Card style={styles.summaryCard} variant="goldBorder">
              <Text style={styles.summaryTitle}>Booking Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Service:</Text>
                <Text style={styles.summaryVal}>{selectedService}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Barber:</Text>
                <Text style={styles.summaryVal}>{selectedBarber}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Date & Time:</Text>
                <Text style={styles.summaryVal}>
                  {selectedDate} @ {selectedTime}
                </Text>
              </View>
              {selectedServiceObj && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total Price:</Text>
                  <Text style={styles.priceVal}>${selectedServiceObj.price.toFixed(2)}</Text>
                </View>
              )}
            </Card>

            <Input
              label="Full Name *"
              placeholder="e.g. John Doe"
              value={customerName}
              onChangeText={setCustomerName}
            />

            <Input
              label="Email Address *"
              placeholder="john.doe@example.com"
              value={customerEmail}
              onChangeText={setCustomerEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Input
              label="Phone Number *"
              placeholder="+1 (555) 000-0000"
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
            />

            <View style={styles.navRow}>
              <Button title="Back" variant="secondary" onPress={() => setStep(2)} style={styles.halfBtn} />
              <Button
                title="Confirm & Reserve"
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
        onClose={() => {
          setReceiptAppointment(null);
          navigation.navigate('Home');
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
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.gold.main,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  stepBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  stepSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.obsidian.border,
  },
  stepActive: {
    backgroundColor: colors.gold.main,
  },
  stepTitle: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
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
  optionTitle: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  optionSub: {
    color: colors.text.muted,
    fontSize: 12,
    marginTop: 2,
  },
  optionPrice: {
    color: colors.gold.main,
    fontSize: 15,
    fontWeight: '700',
  },
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
  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  halfBtn: {
    flex: 1,
  },
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
  priceVal: {
    color: colors.gold.bright,
    fontSize: 15,
    fontWeight: '700',
  },
});
