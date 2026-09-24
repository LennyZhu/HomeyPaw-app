import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getInstalledAppIdentity() {
  return {
    platform: Platform.OS,
    version:
      Platform.OS === 'web'
        ? (Constants.expoConfig?.version ?? null)
        : Application.nativeApplicationVersion,
    build: Platform.OS === 'web' ? '0' : Application.nativeBuildVersion,
  };
}

export function getAppVersionHeaders() {
  const { platform, version, build } = getInstalledAppIdentity();
  return {
    'X-HomeyPaw-Platform': platform,
    'X-HomeyPaw-App-Version': version ?? '',
    'X-HomeyPaw-Build': build ?? '',
  };
}
