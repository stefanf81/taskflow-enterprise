import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Card } from '../../components/common/Card';
import { useAuthStore } from '../../core/auth/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { RootStackParamList, GuestTabParamList } from '../../types/navigation';
import { colors } from '../../theme/colors';
import { AnnouncementBar } from './AnnouncementBar';
import { HomeHeader } from './HomeHeader';
import { HeroSection } from './HeroSection';
import { HomeSection } from './HomeSection';
import { LookbookGallery } from './LookbookGallery';
import { GroomingMenu } from './GroomingMenu';
import { ArtisanalProducts, ClientTestimonial, OperatingHours } from './ShopInfo';
import { MasterStylists } from './MasterStylists';
import { FaqSection } from './FaqSection';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<GuestTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

/**
 * Guest landing page. Each section renders (and loads) itself; this screen owns navigation and
 * the auth state the header and hero switch on.
 */
export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { isAuthenticated, role } = useAuthStore(
    useShallow((state) => ({ isAuthenticated: state.isAuthenticated, role: state.role })),
  );
  const isAdmin = role === 'ROLE_ADMIN';

  const book = (params: GuestTabParamList['Booking']) => navigation.navigate('Booking', params);
  const signIn = () => navigation.navigate('Login');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView testID="home-scroll-view" contentContainerStyle={styles.scrollContent}>
        <AnnouncementBar />

        <HomeHeader onOwnerPortal={isAuthenticated ? undefined : signIn} />

        <HeroSection
          isAuthenticated={isAuthenticated}
          isAdmin={isAdmin}
          onBook={() => book({})}
          onSignIn={signIn}
          onOpenAccount={() => navigation.navigate(isAdmin ? 'AdminTabs' : 'CustomerTabs')}
          onManageBooking={() => navigation.navigate('PublicActions', {})}
        />

        <HomeSection
          title="Style Lookbook"
          subtitle="Explore signature cuts, razor shaves, and tapers"
        >
          <LookbookGallery
            onSelectStyle={(item) => book({ preselectedService: item.serviceName })}
          />
        </HomeSection>

        {/* Web's left column: grooming menu, hours, products, testimonial */}
        <Card style={styles.menuCard}>
          <GroomingMenu />
          <OperatingHours />
          <ArtisanalProducts />
          <ClientTestimonial />
        </Card>

        <MasterStylists onSelectBarber={(name) => book({ preselectedBarber: name })} />

        <FaqSection />

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
  menuCard: {
    marginTop: 20,
  },
  footer: {
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  footerText: {
    color: colors.text.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
