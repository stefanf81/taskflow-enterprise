import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { colors } from '../../theme/colors';
import { ReceiptModal } from './ReceiptModal';
import { BookingHeader } from './BookingHeader';
import { ServiceStep } from './ServiceStep';
import { StylistStep } from './StylistStep';
import { DateTimeStep } from './DateTimeStep';
import { ContactStep } from './ContactStep';
import { getPostBookingDestination } from './bookingWizard';
import { BookingNavProp, useBookingWizard } from './useBookingWizard';

/**
 * Booking wizard: Treatment → Stylist → Date/Slot → Contact, then the receipt. State, validation
 * and submission live in `useBookingWizard`; each step renders in its own component.
 */
export const BookingScreen: React.FC = () => {
  const navigation = useNavigation<BookingNavProp>();
  const wizard = useBookingWizard();

  const closeReceipt = () => {
    wizard.clearReceipt();
    // Guest vs customer tab navigator: only the guest one has 'Home'.
    const routeNames = navigation.getState?.()?.routes.map((r) => r.name) ?? [];
    navigation.dispatch(CommonActions.navigate({ name: getPostBookingDestination(routeNames) }));
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
        <BookingHeader step={wizard.step} />

        <ErrorMessage message={wizard.error || ''} />

        {wizard.step === 1 && (
          <ServiceStep
            services={wizard.services}
            isLoading={wizard.catalogLoading}
            loadFailed={wizard.catalogFailed}
            onRetry={wizard.retryCatalog}
            searchQuery={wizard.serviceSearchQuery}
            onSearchQueryChange={wizard.setServiceSearchQuery}
            category={wizard.selectedCategory}
            onCategoryChange={wizard.setSelectedCategory}
            selectedService={wizard.selectedService}
            onSelectService={wizard.setSelectedService}
            onContinue={wizard.goToNextStep}
          />
        )}

        {wizard.step === 2 && (
          <StylistStep
            barberNames={wizard.barberNames}
            selectedBarber={wizard.selectedBarber}
            onSelectBarber={wizard.setSelectedBarber}
            onBack={wizard.goToPreviousStep}
            onContinue={wizard.goToNextStep}
          />
        )}

        {wizard.step === 3 && (
          <DateTimeStep
            days={wizard.upcomingDays}
            selectedDate={wizard.selectedDate}
            onSelectDate={wizard.setSelectedDate}
            selectedTime={wizard.selectedTime}
            onSelectTime={wizard.setSelectedTime}
            pastSlots={wizard.pastSlots}
            noSlotsLeft={wizard.noSlotsLeft}
            availability={wizard.availability}
            availabilityError={wizard.availabilityError}
            onRetryAvailability={wizard.retryAvailability}
            onBack={wizard.goToPreviousStep}
            onContinue={wizard.goToNextStep}
          />
        )}

        {wizard.step === 4 && (
          <ContactStep
            summary={wizard.summary}
            contact={wizard.contact}
            onChangeContact={wizard.setContactField}
            isSubmitting={wizard.isSubmitting}
            onBack={wizard.goToPreviousStep}
            onSubmit={wizard.submitBooking}
          />
        )}
      </ScrollView>

      {/* Confirmation Receipt Modal */}
      <ReceiptModal
        visible={!!wizard.receipt}
        appointment={wizard.receipt?.appointment ?? null}
        checkoutTotal={wizard.receipt?.total ?? 0}
        onClose={closeReceipt}
        onOpenPublicActions={(publicId) => {
          wizard.clearReceipt();
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
});
