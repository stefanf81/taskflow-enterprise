const mockWrite = jest.fn();
const mockIsAvailable = jest.fn();
const mockShare = jest.fn();
let mockFileArgs: unknown[] = [];

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((...args: unknown[]) => {
    mockFileArgs = args;
    return { uri: `file:///cache/${String(args[1])}`, write: mockWrite };
  }),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

import { shareCalendarFile } from '../src/core/calendar/shareCalendarFile';

describe('shareCalendarFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    mockWrite.mockResolvedValue(undefined);
    mockShare.mockResolvedValue(undefined);
  });

  it('shares the .ics as a file with the iCalendar type, not as text', async () => {
    await expect(
      shareCalendarFile('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'appointment-abc.ics'),
    ).resolves.toBe(true);

    expect(mockFileArgs).toEqual(['file:///cache', 'appointment-abc.ics']);
    expect(mockWrite).toHaveBeenCalledWith('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(mockShare).toHaveBeenCalledWith('file:///cache/appointment-abc.ics', {
      mimeType: 'text/calendar',
      UTI: 'com.apple.ical.ics',
      dialogTitle: 'Add to calendar',
    });
  });

  it('never lets a server-supplied filename leave the cache directory', async () => {
    await shareCalendarFile('x', '../../evil/name.ics');
    expect(mockFileArgs[1]).toBe('....evilname.ics');
  });

  it('reports a device that cannot share files', async () => {
    mockIsAvailable.mockResolvedValue(false);
    await expect(shareCalendarFile('x', 'a.ics')).resolves.toBe(false);
    expect(mockShare).not.toHaveBeenCalled();
  });
});
