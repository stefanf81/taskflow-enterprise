import React from 'react';
import { render } from '@testing-library/react-native';
import { AnnouncementBar } from '../src/features/landing/AnnouncementBar';

const mockStart = jest.fn();
const mockStop = jest.fn();

// Only the loop is replaced; the rest of react-native stays real.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const Animated = Object.create(actual.Animated);
  Animated.loop = () => ({ start: mockStart, stop: mockStop, reset: jest.fn() });
  return Object.create(actual, { Animated: { value: Animated } });
});

describe('AnnouncementBar', () => {
  beforeEach(() => {
    mockStart.mockClear();
    mockStop.mockClear();
  });

  it('pulses only while the landing tab is shown', async () => {
    const { rerender, unmount } = await render(<AnnouncementBar active={false} />);
    expect(mockStart).not.toHaveBeenCalled();

    await rerender(<AnnouncementBar active />);
    expect(mockStart).toHaveBeenCalledTimes(1);

    // Another tab (or a pushed screen) is shown: the tab stays mounted, the loop must stop.
    await rerender(<AnnouncementBar active={false} />);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);

    await rerender(<AnnouncementBar active />);
    expect(mockStart).toHaveBeenCalledTimes(2);
    await unmount();
    expect(mockStop).toHaveBeenCalledTimes(2);
  });

  it('pulses by default', async () => {
    await render(<AnnouncementBar />);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
