import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { StylistCard } from '../components/booking/StylistCard';
import { LookbookGallery } from '../components/lookbook/LookbookGallery';
import { useBarberRatings } from '../hooks/useReviews';
import { useBarbers } from '../hooks/useBarbers';
import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList, GuestTabParamList } from '../types/navigation';
import { colors } from '../theme/colors';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { isAuthenticated, role } = useAuthStore();
  const { data: ratings = [] } = useBarberRatings();
  const { data: apiBarbers = [] } = useBarbers();

  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  // Fallback static data used when the API hasn't loaded yet
  const fallbackBarbers = [
    { id: 1, name: 'Alex the Barber', email: '', phone: '' },
    { id: 2, name: 'Sara the Stylist', email: '', phone: '' },
    { id: 3, name: 'Marcus Master Blade', email: '', phone: '' },
  ];
  const barbers = apiBarbers.length > 0 ? apiBarbers : fallbackBarbers;

  const barberMeta: Record<string, { title: string; specialty: string }> = {
    'Alex the Barber': { title: 'Master Stylist', specialty: 'Classic Scissor Cuts' },
    'Sara the Stylist': { title: 'Skin Fade Expert', specialty: 'Skin Fades & Tapers' },
    'Marcus Master Blade': { title: 'Director Barber', specialty: 'Razor Shaves & Beards' },
  };

  const faqs = [
    {
      q: 'Do I need an account to book an appointment?',
      a: 'No! You can book instantly as a guest. We will issue a unique Public Reference ID for tracking, cancellations, and reviews.',
    },
    {
      q: 'What is your cancellation policy?',
      a: 'You can cancel up to 2 hours prior to your scheduled slot using your Public Reference ID and Email.',
    },
    {
      q: 'How does payment work?',
      a: 'Payment is collected in-salon upon service completion. All major cards and cash are accepted.',
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header / Hero */}
        <View style={styles.heroContainer}>
          <Text style={styles.tagline}>PRECISION CUTS & LUXURY GROOMING</Text>
          <Text style={styles.heroTitle}>TaskFlow Salon</Text>
          <Text style={styles.heroSubtitle}>
            Experience top-tier craftsmanship with our master barbers. Book your next appointment seamlessly.
          </Text>

          <View style={styles.heroButtons}>
            <Button
              title="Book Appointment"
              variant="primary"
              size="lg"
              icon={<Ionicons name="calendar" size={18} color={colors.obsidian.bg} />}
              onPress={() => navigation.navigate('Booking', {})}
              style={styles.heroBtn}
            />
            {!isAuthenticated ? (
              <Button
                title="Sign In / Register"
                variant="outline"
                size="lg"
                onPress={() => navigation.navigate('Login')}
                style={styles.heroBtn}
              />
            ) : (
              <Button
                title={role === 'ROLE_ADMIN' ? 'Admin Portal' : 'My Account'}
                variant="outline"
                size="lg"
                onPress={() =>
                  navigation.navigate(role === 'ROLE_ADMIN' ? 'AdminTabs' : 'CustomerTabs')
                }
                style={styles.heroBtn}
              />
            )}
          </View>
        </View>

        {/* Quick Actions Bar */}
        <Card style={styles.quickCard}>
          <Text style={styles.sectionHeader}>Quick Actions</Text>
          <View style={styles.quickGrid}>
            <TouchableOpacity
              style={styles.quickItem}
              onPress={() => navigation.navigate('Catalog')}
            >
              <View style={styles.quickIcon}>
                <Ionicons name="list" size={24} color={colors.gold.main} />
              </View>
              <Text style={styles.quickText}>Services</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickItem}
              onPress={() => navigation.navigate('Lookbook')}
            >
              <View style={styles.quickIcon}>
                <Ionicons name="images" size={24} color={colors.gold.main} />
              </View>
              <Text style={styles.quickText}>Lookbook</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickItem}
              onPress={() => navigation.navigate('PublicActions', {})}
            >
              <View style={styles.quickIcon}>
                <Ionicons name="ticket" size={24} color={colors.gold.main} />
              </View>
              <Text style={styles.quickText}>My Booking</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Master Stylists */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Master Stylists</Text>
          <Text style={styles.sectionSub}>Select a barber or choose first available</Text>

          {barbers.map((b) => {
            const dbRating = ratings.find((r) => r.barberName === b.name);
            const ratingText = dbRating ? `${dbRating.averageRating.toFixed(1)} ★` : '5.0 ★';
            const reviewsCount = dbRating ? `${dbRating.reviewCount} reviews` : 'New';
            const meta = barberMeta[b.name] || { title: 'Stylist', specialty: 'Salon Services' };

            return (
              <StylistCard
                key={b.id?.toString() || b.name}
                name={b.name}
                title={meta.title}
                specialty={meta.specialty}
                rating={ratingText}
                reviewsCount={reviewsCount}
                onSelect={() => navigation.navigate('Booking', { preselectedBarber: b.name })}
              />
            );
          })}
        </View>

        {/* Style Inspiration */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Style Inspiration</Text>
          <Text style={styles.sectionSub}>Popular haircuts & razor shaves from our lookbook</Text>
          <LookbookGallery
            onSelectStyle={(item) =>
              navigation.navigate('Booking', { preselectedBarber: item.barber })
            }
          />
        </View>

        {/* FAQs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {faqs.map((f, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <TouchableOpacity
                key={idx}
                style={styles.faqCard}
                onPress={() => setActiveFaq(isOpen ? null : idx)}
              >
                <View style={styles.faqHeader}>
                  <Text style={styles.faqQ}>{f.q}</Text>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.gold.main}
                  />
                </View>
                {isOpen && <Text style={styles.faqA}>{f.a}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
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
  heroContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  tagline: {
    color: colors.gold.main,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  heroTitle: {
    color: colors.text.primary,
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroSubtitle: {
    color: colors.text.secondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  heroButtons: {
    width: '100%',
    gap: 12,
  },
  heroBtn: {
    width: '100%',
  },
  quickCard: {
    marginVertical: 16,
  },
  sectionHeader: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  quickItem: {
    alignItems: 'center',
  },
  quickIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.gold.dim,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  quickText: {
    color: colors.text.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  sectionSub: {
    color: colors.text.secondary,
    fontSize: 13,
    marginBottom: 16,
    marginTop: 2,
  },
  faqCard: {
    backgroundColor: colors.obsidian.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.obsidian.border,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQ: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  faqA: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 10,
    lineHeight: 18,
  },
});
