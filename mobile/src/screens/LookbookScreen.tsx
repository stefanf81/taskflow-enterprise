import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { LookbookGallery } from '../components/lookbook/LookbookGallery';
import { GuestTabParamList } from '../types/navigation';
import { colors } from '../theme/colors';

export const LookbookScreen: React.FC = () => {
  const navigation = useNavigation<BottomTabNavigationProp<GuestTabParamList>>();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Style Lookbook</Text>
          <Text style={styles.subtitle}>
            Explore signature cuts, razor shaves, and tapers crafted by our master stylists
          </Text>
        </View>

        <LookbookGallery
          onSelectStyle={(item) =>
            navigation.navigate('Booking', { preselectedBarber: item.barber })
          }
        />
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
  header: {
    marginBottom: 16,
  },
  title: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
});
