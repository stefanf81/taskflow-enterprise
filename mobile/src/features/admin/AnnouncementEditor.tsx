import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { announcementSchema } from '@taskflow/schemas';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { Input } from '../../components/common/Input';
import { useUpdateAnnouncement } from '../../core/catalog/announcement';
import { useShopInfo } from '../../core/shop/useShopInfo';
import { colors, semantic } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

/** The backend's limit (V45): the prerendered web page reserves room for this much text. */
const MAX_LENGTH = 120;

/**
 * Owner · catalog · storefront: the promo strip at the top of the home screen and the website.
 * Empty hides it. Starts from the published text; a save refetches the shop info.
 */
export const AnnouncementEditor: React.FC = () => {
  const { announcement, loaded } = useShopInfo();
  const mutation = useUpdateAnnouncement();
  // The text being edited; null means "show the published one" (no copy of server state to sync).
  const [edited, setEdited] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const draft = edited ?? announcement;

  const submit = (message: string) => {
    if (mutation.isPending) return;
    const parsed = announcementSchema.safeParse({ message: message.trim() || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the announcement.');
      return;
    }
    setError('');
    setSaved('');
    mutation.mutate(parsed.data, {
      onSuccess: (result) => {
        setEdited(null);
        setSaved(result.active ? 'Announcement saved.' : 'The strip is hidden.');
      },
      onError: (err) => setError(getApiErrorMessage(err, 'Could not save the announcement. Please try again.')),
    });
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Home screen announcement</Text>
      <Text style={styles.hint}>The strip at the top of the app and the website. Leave it empty to hide it.</Text>
      <ErrorMessage message={error} />
      {saved !== '' && <Text style={styles.saved}>{saved}</Text>}
      <Input
        label="Announcement text"
        value={draft}
        maxLength={MAX_LENGTH}
        multiline
        autoComplete="off"
        editable={loaded && !mutation.isPending}
        onChangeText={setEdited}
      />
      <Text style={styles.count}>
        {draft.length} / {MAX_LENGTH} characters
      </Text>
      <View style={styles.actions}>
        <Button title="Save announcement" size="sm" loading={mutation.isPending} disabled={!loaded || mutation.isPending} onPress={() => submit(draft)} />
        <Button title="Hide the strip" variant="secondary" size="sm" disabled={mutation.isPending || announcement === ''} onPress={() => submit('')} />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 20,
  },
  title: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  hint: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 12,
  },
  saved: {
    color: semantic.success,
    fontSize: 13,
    marginBottom: 8,
  },
  count: {
    color: colors.text.muted,
    fontSize: 12,
    marginTop: -8,
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
});
