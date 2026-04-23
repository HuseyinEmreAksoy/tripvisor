module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEach: ['<rootDir>/jest-setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-native-community|expo-modules-core|@supabase/.*|@tanstack/.*))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/supabase/functions/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
