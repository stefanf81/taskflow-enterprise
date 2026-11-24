import React from 'react';
import { act, render, fireEvent, screen } from '@testing-library/react-native';
import { AnnouncementEditor } from '../src/features/admin/AnnouncementEditor';

const mockMutate = jest.fn();
let mockAnnouncement = 'Old promo';

jest.mock('../src/core/shop/useShopInfo', () => ({
  useShopInfo: () => ({ announcement: mockAnnouncement, loaded: true }),
}));
jest.mock('../src/core/catalog/announcement', () => ({
  useUpdateAnnouncement: () => ({ mutate: mockMutate, isPending: false }),
}));

describe('AnnouncementEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnnouncement = 'Old promo';
  });

  it('starts from the published text and saves the trimmed edit', async () => {
    await render(<AnnouncementEditor />);
    expect(screen.getByDisplayValue('Old promo')).toBeTruthy();
    expect(screen.getByText('9 / 120 characters')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Announcement text'), '  New promo ');
    await fireEvent.press(screen.getByText('Save announcement'));
    expect(mockMutate).toHaveBeenCalledWith({ message: 'New promo' }, expect.anything());

    const { onSuccess } = mockMutate.mock.calls[0][1];
    await act(async () => onSuccess({ active: true, message: 'New promo' }));
    expect(screen.getByText('Announcement saved.')).toBeTruthy();
  });

  it('hides the strip with an empty message, and only when one is shown', async () => {
    await render(<AnnouncementEditor />);
    await fireEvent.press(screen.getByText('Hide the strip'));
    expect(mockMutate).toHaveBeenCalledWith({}, expect.anything());
  });

  it('shows a save error', async () => {
    await render(<AnnouncementEditor />);
    await fireEvent.press(screen.getByText('Save announcement'));
    const { onError } = mockMutate.mock.calls[0][1];
    await act(async () => onError({}));
    expect(screen.getByText('Could not save the announcement. Please try again.')).toBeTruthy();
  });
});
