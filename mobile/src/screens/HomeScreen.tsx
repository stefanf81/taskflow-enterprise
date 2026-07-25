import React, { useState, useRef, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useCatalog } from '../hooks/useCatalog';
import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList, GuestTabParamList } from '../types/navigation';
import { colors } from '../theme/colors';

// Module-level constants — defined outside the component to avoid
// re-creation on every render (P1: memoization of static data).

const FALLBACK_BARBERS = [
  { id: 1, name: 'Alex the Barber', email: '', phone: '' },
  { id: 2, name: 'Sara the Stylist', email: '', phone: '' },
  { id: 3, name: 'Marcus Master Blade', email: '', phone: '' },
];

const BARBER_META: Record<string, { title: string; specialty: string; badge?: string }> = {
  'Alex the Barber': { title: 'Master Stylist', specialty: 'Classic Scissor Cuts', badge: 'Top Rated' },
  'Sara the Stylist': { title: 'Skin Fade Expert', specialty: 'Skin Fades & Tapers', badge: 'Featured' },
  'Marcus Master Blade': { title: 'Director Barber', specialty: 'Razor Shaves & Beards', badge: 'Master Barber' },
};

const FAQS = [
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

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { isAuthenticated, role } = useAuthStore();
  const { data: ratings = [] } = useBarberRatings();
  const { data: apiBarbers = [] } = useBarbers();
  const { data: services = [] } = useCatalog();

  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const pingAnim = useRef(new Animated.Value(1)).current;

  // Animated ping effect for promo dot
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pingAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pingAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pingAnim]);

  // Use module-level constants (P1: no re-creation per render)
  const barbers = apiBarbers.length > 0 ? apiBarbers : FALLBACK_BARBERS;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ===== ANNOUNCEMENT BAR ===== */}
        <View style={styles.announcementBar}>
          <Animated.View style={[styles.pingDot, { opacity: pingAnim }]} />
          <Text style={styles.announcementText}>
            Special Highlight: Book 'The Executive Package' today and get 15% off any premium hair
            styling clay!
          </Text>
        </View>

        {/* ===== STICKY NAV HEADER ===== */}
        <View style={styles.navHeader}>
          <View style={styles.navBrand}>
            <Ionicons name="checkmark-circle" size={24} color={colors.gold.main} />
            <Text style={styles.navTitle}>
              TaskFlow <Text style={styles.navPro}>pro</Text>
            </Text>
          </View>
          <View style={styles.navRight}>
            <View style={styles.shopBadge}>
              <View style={styles.shopDot} />
              <Text style={styles.shopText}>Shop Open</Text>
            </View>
            {!isAuthenticated && (
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={styles.ownerLink}>Owner Portal</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ===== HERO SECTION ===== */}
        <View style={styles.heroContainer}>
          <View style={styles.squireBadge}>
            <Text style={styles.squireText}>SQUIRE INTEGRATED</Text>
          </View>
          <Text style={styles.heroTitle}>
            Luxury Barber{' '}
            <Text style={styles.heroGold}>Scheduler</Text>
          </Text>
          <Text style={styles.heroSubtitle}>
            Premium classic cuts, modern fades, hot towel straight-razor shaves, and beard sculpture
            managed with absolute scheduling precision.
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

        {/* ===== LOOKBOOK SHOWCASE ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Style Lookbook</Text>
          <Text style={styles.sectionSub}>Explore signature cuts, razor shaves, and tapers</Text>
          <LookbookGallery
            onSelectStyle={(item) =>
              navigation.navigate('Booking', { preselectedBarber: item.barber })
            }
          />
        </View>

        {/* ===== TWO-COLUMN LAYOUT (Services left + Booking right) ===== */}
        {/* LEFT COLUMN: Grooming Menu, Hours, Products, Testimonials */}
        <Card style={styles.menuCard}>
          <Text style={styles.menuHeader}>Grooming Menu</Text>

          {services.map((svc) => (
            <View key={svc.id} style={styles.menuItem}>
              <View style={styles.menuTop}>
                <Text style={styles.menuName}>{svc.name}</Text>
                <Text style={styles.menuPrice}>${svc.price.toFixed(0)}</Text>
              </View>
              <Text style={styles.menuDuration}>Duration: {svc.durationMinutes} mins</Text>
              <Text style={styles.menuDesc}>{svc.description}</Text>
            </View>
          ))}

          {/* Operating Hours */}
          <View style={styles.hoursCard}>
            <Text style={styles.cardLabel}>Operating Hours</Text>
            <View style={styles.hoursRow}>
              <Text style={styles.hoursDay}>Monday - Friday</Text>
              <Text style={styles.hoursTime}>09:00 AM - 06:00 PM</Text>
            </View>
            <View style={styles.hoursRow}>
              <Text style={styles.hoursDay}>Saturday</Text>
              <Text style={styles.hoursTime}>10:00 AM - 04:00 PM</Text>
            </View>
            <View style={styles.hoursRow}>
              <Text style={[styles.hoursDay, styles.closedDay]}>Sunday</Text>
              <Text style={[styles.hoursTime, styles.closedDay]}>CLOSED</Text>
            </View>
          </View>

          {/* Artisanal Products */}
          <View style={styles.productsCard}>
            <Text style={styles.cardLabel}>Artisanal Products</Text>
            <View style={styles.productRow}>
              <Text style={styles.productName}>Styling Fiber Clay (100ml)</Text>
              <Text style={styles.productPrice}>$24.00</Text>
            </View>
            <View style={styles.productRow}>
              <Text style={styles.productName}>Sandalwood Beard Balm (60ml)</Text>
              <Text style={styles.productPrice}>$19.00</Text>
            </View>
            <View style={styles.productRow}>
              <Text style={styles.productName}>Straight Razor Shave Cream (150ml)</Text>
              <Text style={styles.productPrice}>$22.00</Text>
            </View>
          </View>

          {/* Client Social Proof */}
          <View style={styles.testimonialCard}>
            <Text style={styles.cardLabel}>Client Social Proof</Text>
            <Text style={styles.testimonialText}>
              "The best skin fade I have ever had. Sara is incredibly meticulous and the royal
              steam towel shave is pure heaven. I will never go anywhere else!"
            </Text>
            <Text style={styles.testimonialAuthor}>— Liam K. (5/5 ★)</Text>
          </View>
        </Card>

        {/* ===== MASTER STYLISTS ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Master Stylists</Text>
          <Text style={styles.sectionSub}>Select a barber or choose first available</Text>

          {barbers.map((b) => {
            const dbRating = ratings.find((r) => r.barberName === b.name);
            const ratingText = dbRating ? `${dbRating.averageRating.toFixed(1)} ★` : '5.0 ★';
            const reviewsCount = dbRating ? `${dbRating.reviewCount} reviews` : 'New';
            const meta = BARBER_META[b.name] || { title: 'Stylist', specialty: 'Salon Services' };

            return (
              <StylistCard
                key={b.id?.toString() || b.name}
                name={b.name}
                title={meta.title}
                specialty={meta.specialty}
                rating={ratingText}
                reviewsCount={reviewsCount}
                badge={meta.badge}
                onSelect={() => navigation.navigate('Booking', { preselectedBarber: b.name })}
              />
            );
          })}
        </View>

        {/* ===== FAQS ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {FAQS.map((f, idx) => {
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

        {/* ===== FOOTER ===== */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            TaskFlow platform is 100% secured utilizing industry standard SSL/TLS and stateless
            RSA-2048 OAuth2 encryption protocols.
          </Text>
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
    paddingBottom: 40,
  },

  // Announcement Bar
  announcementBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181b',
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 16,
    gap: 8,
  },
  pingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold.main,
  },
  announcementText: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },

  // Sticky Nav
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navTitle: {
    color: '#f4f4f5',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  navPro: {
    color: colors.gold.main,
    fontWeight: '300',
    fontSize: 14,
    textTransform: 'lowercase',
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shopBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  shopDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
  },
  shopText: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '700',
  },
  ownerLink: {
    color: '#a1a1aa',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Hero
  heroContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  squireBadge: {
    backgroundColor: 'rgba(197, 160, 89, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(197, 160, 89, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  squireText: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
    lineHeight: 34,
  },
  heroGold: {
    color: colors.gold.main,
  },
  heroSubtitle: {
    color: '#a1a1aa',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  heroButtons: {
    width: '100%',
    gap: 12,
  },
  heroBtn: {
    width: '100%',
  },

  // Quick Access Card
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

  // Sections
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  sectionSub: {
    color: colors.text.secondary,
    fontSize: 13,
    marginBottom: 16,
    marginTop: 2,
  },

  // Menu Card (replaces left column)
  menuCard: {
    marginTop: 20,
  },
  menuHeader: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  menuItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 12,
    marginBottom: 12,
  },
  menuTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  menuName: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  menuPrice: {
    color: colors.gold.main,
    fontSize: 14,
    fontWeight: '800',
  },
  menuDuration: {
    color: colors.text.muted,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  menuDesc: {
    color: colors.text.secondary,
    fontSize: 12,
    lineHeight: 16,
  },

  // Operating Hours
  hoursCard: {
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(24,24,27,0.5)',
    padding: 16,
  },
  cardLabel: {
    color: colors.text.primary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  hoursDay: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  hoursTime: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  closedDay: {
    color: '#f87171',
    fontWeight: '700',
  },

  // Products
  productsCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(229, 193, 133, 0.05)',
    padding: 16,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  productName: {
    color: '#a1a1aa',
    fontSize: 12,
  },
  productPrice: {
    color: colors.gold.main,
    fontSize: 12,
    fontWeight: '700',
  },

  // Testimonial
  testimonialCard: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(24,24,27,0.3)',
    padding: 16,
  },
  testimonialText: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  testimonialAuthor: {
    color: '#d4d4d8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'right',
    marginTop: 10,
  },

  // FAQs
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
  // Footer
  footer: {
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  footerText: {
    color: '#71717a',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
