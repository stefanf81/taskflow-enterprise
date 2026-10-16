// jest-expo 58 mocks `react-native/asset-registry`, but expo-asset 58 reads `AssetRegistry`
// from `react-native` (RN 0.88: src/private/assets/AssetRegistry), so the preset mock never
// applies and every icon font fails with 'Module "1" is missing from the asset registry'.
jest.mock('react-native/src/private/assets/AssetRegistry', () => ({
  AssetRegistry: {
    registerAsset: jest.fn(() => 1),
    getAssetByID: jest.fn(() => ({
      __packager_asset: true,
      fileSystemLocation: '/full/path/to/directory',
      httpServerLocation: '/assets/full/path/to/directory',
      scales: [1],
      fileHashes: ['md5'],
      name: 'name',
      type: 'type',
      hash: 'md5',
      width: 1,
      height: 1,
    })),
  },
}));
