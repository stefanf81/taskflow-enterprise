import { create } from 'zustand';

interface UIState {
  searchQuery: string;
  selectedFilter: string;
  selectedCategory: string;
  serviceSearchQuery: string;
  activeBookingStep: number;

  setSearchQuery: (query: string) => void;
  setSelectedFilter: (filter: string) => void;
  setSelectedCategory: (category: string) => void;
  setServiceSearchQuery: (query: string) => void;
  setActiveBookingStep: (step: number) => void;
  resetBookingStep: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  searchQuery: '',
  selectedFilter: 'all',
  selectedCategory: 'all',
  serviceSearchQuery: '',
  activeBookingStep: 1,

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedFilter: (selectedFilter) => set({ selectedFilter }),
  setSelectedCategory: (selectedCategory) => set({ selectedCategory }),
  setServiceSearchQuery: (serviceSearchQuery) => set({ serviceSearchQuery }),
  setActiveBookingStep: (activeBookingStep) => set({ activeBookingStep }),
  resetBookingStep: () => set({ activeBookingStep: 1 }),
}));
