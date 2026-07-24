import React from 'react';
import { render, screen } from '@testing-library/react-native';

const mockRefetch = jest.fn();
jest.mock('../src/hooks/useAppointments', () => ({
  useAppointments: () => ({
    data: {
      page: {
        content: [
          {
            id: 1, publicId: 'TF-0001', customerName: 'John Doe', customerEmail: 'john@ex.com',
            customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-15',
            bookingTime: '10:00', serviceType: 'Haircut', status: 'PENDING' as const,
            createdAt: '', updatedAt: '',
          },
        ],
        totalPages: 1,
      },
      stats: { total: 1, pending: 1, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 },
    },
    isLoading: false,
    refetch: mockRefetch,
  }),
  useUpdateAppointmentStatus: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteAppointment: () => ({ mutate: jest.fn(), isPending: false }),
}));

const mockLogout = jest.fn();
jest.mock('../src/store/useAuthStore', () => ({
  useAuthStore: () => ({ logout: mockLogout }),
}));

import { AdminDashboardScreen } from '../src/screens/AdminDashboardScreen';

describe('AdminDashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders admin control center header', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Owner Panel')).toBeTruthy();
  });

  it('renders stats board', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Total Bookings')).toBeTruthy();
    // "Pending Approval" appears in stats AND in legend
    const pendingApprovals = screen.getAllByText('Pending Approval');
    expect(pendingApprovals.length).toBeGreaterThanOrEqual(1);
    const approvedSlots = screen.getAllByText('Approved Slots');
    expect(approvedSlots.length).toBeGreaterThanOrEqual(1);
  });

  it('renders appointment list', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('John Doe')).toBeTruthy();
    expect(screen.getByText('TF-0001')).toBeTruthy();
  });

  it('renders action buttons for pending appointment', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('renders filter chips', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('ALL')).toBeTruthy();
    // PENDING appears both as filter AND in the stat card
    const pendings = screen.getAllByText('PENDING');
    expect(pendings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders owner guidelines sidebar', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Owner Guidelines')).toBeTruthy();
  });

  it('renders progress card', async () => {
    await render(<AdminDashboardScreen />);
    expect(screen.getByText('Slot Approval Completion Rate')).toBeTruthy();
  });
});
