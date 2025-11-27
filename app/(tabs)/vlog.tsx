import { CameraView, useCameraPermissions } from 'expo-camera';
// Expo SDK 54: writeAsStringAsync 在新 API 中標示為 deprecated，改用 legacy 介面
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

// 記憶體儲存（適用於 Expo Go）
type SampleRow = {
  id?: number;
  created_at: string;
  sentiment?: number | null;
  activity?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  video_uri?: string | null;
};

const memoryDB: SampleRow[] = [];

export default function VlogScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  // no-op state removed for cleanliness
  const [lastLocation, setLastLocation] = useState<Location.LocationObject | null>(null);
  const [lastVideoUri, setLastVideoUri] = useState<string | null>(null);
  const [dbCount, setDbCount] = useState<number>(0);
  const cameraRef = useRef<CameraView | null>(null);
  const [recording, setRecording] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  // Questionnaire state
  const [sentiment, setSentiment] = useState<number>(3);
  const [activity, setActivity] = useState<string>('');

  // 簡易記憶體資料庫函式（Expo Go 相容）
  const insertSample = useCallback(async (payload: SampleRow) => {
    memoryDB.unshift({
      id: memoryDB.length + 1,
      created_at: payload.created_at ?? new Date().toISOString(),
      sentiment: payload.sentiment ?? null,
      activity: payload.activity ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      video_uri: payload.video_uri ?? null,
    });
  }, []);

  const getCount = useCallback(async () => memoryDB.length, []);

  const getAllSamples = useCallback(async () => [...memoryDB], []);

  useEffect(() => {
    // Notifications: set handler to show alerts when foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldShowAlert: true,
        shouldSetBadge: false,
        // Newer SDKs also support these display hints
        shouldShowBanner: true,
        shouldShowList: true,
      }) as any,
    });
  }, []);

  useEffect(() => {
    // Preload DB count
    getCount().then(setDbCount).catch(() => {});
  }, [getCount]);

  const ensurePermissions = useCallback(async () => {
    // Camera
    if (!cameraPermission?.granted) {
      await requestCameraPermission();
    }
    // Media library
    if (!mediaPermission?.granted) {
      await requestMediaPermission();
    }
    // Notifications
    const notif = await Notifications.getPermissionsAsync();
    if (notif.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
    // Location
  await Location.requestForegroundPermissionsAsync();
  }, [cameraPermission?.granted, mediaPermission?.granted, requestCameraPermission, requestMediaPermission]);

  useEffect(() => {
    // Ask once on mount
    ensurePermissions();
  }, [ensurePermissions]);

  const scheduleDailyNotifications = useCallback(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    
    const times = [
      { hour: 9, minute: 0 },  // 9:00 AM
      { hour: 14, minute: 0 }, // 2:00 PM
      { hour: 20, minute: 0 }, // 8:00 PM
    ];

    for (const time of times) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '經驗取樣提醒',
          body: '請記錄你現在的心情、活動與 1 秒 vlog！',
        },
        trigger: {
          hour: time.hour,
          minute: time.minute,
          repeats: true,
        } as any,
      });
    }
    
    Alert.alert('已設定', '每日 9:00、14:00、20:00 會提醒你記錄');
  }, []);

  const getCurrentLocation = useCallback(async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const request = await Location.requestForegroundPermissionsAsync();
      if (request.status !== 'granted') {
        Alert.alert('需要定位權限');
        return null;
      }
    }
    const loc = await Location.getCurrentPositionAsync({});
    setLastLocation(loc);
    return loc;
  }, []);

  const toggleCamera = useCallback(() => setShowCamera((v) => !v), []);

  const recordOneSecondVlog = useCallback(async () => {
    if (!cameraRef.current) return null;
    
    try {
      setRecording(true);
      const cam: any = cameraRef.current as any;
      const video: any = await cam.recordAsync?.({ maxDuration: 1 }); // 1 second
      if (video?.uri) {
        const asset = await MediaLibrary.createAssetAsync(video.uri);
        setLastVideoUri(asset.uri ?? video.uri);
        return asset.uri ?? video.uri;
      }
    } catch (e: any) {
      Alert.alert('錄影失敗', e?.message ?? String(e));
    } finally {
      setRecording(false);
    }
    return null;
  }, []);

  const submitSample = useCallback(async () => {
    const loc = await getCurrentLocation();
    
    let videoUri = lastVideoUri;
    if (showCamera && cameraRef.current) {
      videoUri = await recordOneSecondVlog();
    }

    await insertSample({
      created_at: new Date().toISOString(),
      sentiment,
      activity: activity.trim() || null,
      latitude: loc?.coords.latitude ?? null,
      longitude: loc?.coords.longitude ?? null,
      video_uri: videoUri ?? null,
    } as any);

    const count = await getCount();
    setDbCount(count);
    
    Alert.alert('已儲存', `記錄已儲存（共 ${count} 筆）`);
    
    setSentiment(3);
    setActivity('');
    setShowCamera(false);
  }, [sentiment, activity, lastVideoUri, showCamera, getCurrentLocation, recordOneSecondVlog, insertSample, getCount]);

  const exportData = useCallback(async () => {
    const samples = await getAllSamples();
    if (samples.length === 0) {
      Alert.alert('無資料', '尚無記錄可匯出');
      return;
    }

    const json = JSON.stringify(samples, null, 2);
    const fsDoc: string = (FileSystem as any).documentDirectory || '';
    const path = `${fsDoc}samples_export.json`;
    await FileSystem.writeAsStringAsync(path, json);

    const available = await Sharing.isAvailableAsync();
    if (available) {
      await Sharing.shareAsync(path);
    } else {
      Alert.alert('匯出完成', `已儲存至 ${path}`);
    }
  }, [getAllSamples]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>經驗取樣 App</Text>
      <Text style={styles.caption}>每天 3 次：問卷 + 1 秒 vlog + GPS</Text>

      <View style={styles.section}>
        <Button title="設定每日 3 次提醒（9am/2pm/8pm）" onPress={scheduleDailyNotifications} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>你現在的心情（1=很糟 ～ 5=很好）</Text>
        <View style={styles.sentimentRow}>
          {[1, 2, 3, 4, 5].map((val) => (
            <Button
              key={val}
              title={String(val)}
              onPress={() => setSentiment(val)}
              color={sentiment === val ? '#007AFF' : '#999'}
            />
          ))}
        </View>
        <Text style={styles.mono}>已選：{sentiment}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>你現在在做什麼？</Text>
        <TextInput
          style={styles.input}
          placeholder="例如：上課、吃飯、運動..."
          value={activity}
          onChangeText={setActivity}
        />
      </View>

      <View style={styles.section}>
        <Button title="取得目前位置（GPS）" onPress={getCurrentLocation} />
        {lastLocation && (
          <Text style={styles.mono}>
            lat: {lastLocation.coords.latitude.toFixed(6)} | lon: {lastLocation.coords.longitude.toFixed(6)}
          </Text>
        )}
      </View>

      {Platform.OS !== 'web' && (
        <View style={styles.section}>
          <Button title={showCamera ? '關閉相機' : '開啟相機（錄 1 秒 vlog）'} onPress={toggleCamera} />
          {showCamera && (
            <View style={{ width: '100%', aspectRatio: 3 / 4, marginTop: 8, borderRadius: 12, overflow: 'hidden' }}>
              <CameraView ref={cameraRef} mode="video" facing="back" style={{ flex: 1 }} />
            </View>
          )}
          {showCamera && (
            <View style={{ marginTop: 8 }}>
              <Button title={recording ? '錄影中...' : '錄製 1 秒 vlog'} onPress={recordOneSecondVlog} disabled={recording} />
            </View>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Button title="📝 送出記錄（問卷+GPS+vlog）" onPress={submitSample} color="#28a745" />
      </View>

      <View style={styles.section}>
        <Text>資料庫記錄數：{dbCount}</Text>
        <Button title="匯出資料（JSON）" onPress={exportData} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  caption: {
    color: '#666',
  },
  section: {
    marginTop: 12,
    gap: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
  sentimentRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-around',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
  },
});
