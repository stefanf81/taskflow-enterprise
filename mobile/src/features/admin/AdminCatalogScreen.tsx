import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { serviceItemSchema } from '@taskflow/schemas';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Card } from '../../components/common/Card';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { useFlashMessage } from '../../components/common/useFlashMessage';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { useCatalog, useRestoreService, useRetiredServices, useCreateService, useUpdateService, useRetireService } from '../../core/catalog/useCatalog';
import { ServiceItem } from '../../types/api';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

type CatalogTab = 'active' | 'retired';
type ServiceDraft = { name: string; price: string; durationMinutes: string; category: string; description: string };
const emptyDraft = (): ServiceDraft => ({ name: '', price: '', durationMinutes: '', category: '', description: '' });

const TABS: ReadonlyArray<{ key: CatalogTab; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'retired', label: 'Retired' },
];

export const AdminCatalogScreen: React.FC = () => {
  const [tab, setTab] = useState<CatalogTab>('active');
  const showingRetired = tab === 'retired';

  // The retired list is only requested once its tab is opened.
  const active = useCatalog();
  const retired = useRetiredServices({ enabled: showingRetired });
  const { data: services = [], isLoading, isError, refetch } = showingRetired ? retired : active;

  const restoreMutation = useRestoreService();
  const createMutation = useCreateService();
  const updateMutation = useUpdateService();
  const retireMutation = useRetireService();
  const pending = restoreMutation.isPending || createMutation.isPending || updateMutation.isPending || retireMutation.isPending;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ServiceDraft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [retiring, setRetiring] = useState<ServiceItem | null>(null);
  const { successMessage, errorMessage, showSuccess, showError } = useFlashMessage();

  const handleRestore = (id: number, name: string) => {
    if (pending) return;
    restoreMutation.mutate(id, {
      onSuccess: () => showSuccess(`${name} is bookable again.`),
      onError: (err) => showError(getApiErrorMessage(err, `Could not restore ${name}.`)),
    });
  };

  const openEditor = (service?: ServiceItem) => {
    if (pending) return;
    setEditingId(service?.id ?? null);
    setDraft(service ? { name: service.name, price: String(service.price), durationMinutes: String(service.durationMinutes), category: service.category, description: service.description } : emptyDraft());
    setFormError('');
    setEditorOpen(true);
  };

  const save = () => {
    if (pending) return;
    const parsed = serviceItemSchema.safeParse({ ...draft, price: Number(draft.price), durationMinutes: Number(draft.durationMinutes) });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Please check the service details.');
      return;
    }
    setFormError('');
    const options = {
      onSuccess: (saved: ServiceItem) => {
        setEditorOpen(false);
        showSuccess(`${saved.name} ${editingId === null ? 'created' : 'updated'}.`);
      },
      onError: (err: unknown) => setFormError(getApiErrorMessage(err, 'Could not save the service. Please try again.')),
    };
    if (editingId === null) createMutation.mutate(parsed.data, options);
    else updateMutation.mutate({ id: editingId, request: parsed.data }, options);
  };

  const confirmRetire = () => {
    if (!retiring || pending) return;
    retireMutation.mutate(retiring.id, {
      onSuccess: () => {
        setRetiring(null);
        showSuccess(`${retiring.name} removed from the booking menu.`);
      },
      onError: (err) => {
        setRetiring(null);
        showError(getApiErrorMessage(err, `Could not retire ${retiring.name}.`));
      },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.badgeLabel}>SERVICE CATALOG</Text>
          <Text style={styles.title}>Menu & Pricing</Text>
        </View>

        <Button title="Create service" onPress={() => openEditor()} disabled={pending} style={styles.createButton} />

        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map(({ key, label }) => {
            const selected = tab === key;
            return (
              <TouchableOpacity
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.tab, selected && styles.tabSelected]}
                onPress={() => setTab(key)}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ErrorMessage message={errorMessage || ''} />
        {successMessage && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        )}

        {isError ? (
          <ErrorState
            message={
              showingRetired
                ? "Couldn't load the retired services."
                : "Couldn't load the service catalog."
            }
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <LoadingIndicator
            message={showingRetired ? 'Loading retired services...' : 'Loading service catalog...'}
          />
        ) : services.length === 0 ? (
          showingRetired ? (
            <EmptyState
              icon="archive-outline"
              title="No Retired Services"
              message="A service is retired when it is deleted but still has bookings."
            />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title="No Services Found"
              message="The service catalog is currently empty."
            />
          )
        ) : (
          <FlatList
            data={services}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.price}>${item.price.toFixed(2)}</Text>
                </View>
                <Text style={styles.category}>{item.category.toUpperCase()}</Text>
                <Text style={styles.description}>{item.description}</Text>
                <Text style={styles.duration}>Duration: {item.durationMinutes} mins</Text>
                {showingRetired && (
                  <Button
                    title="Restore"
                    variant="secondary"
                    size="sm"
                    loading={restoreMutation.isPending && restoreMutation.variables === item.id}
                    disabled={pending}
                    onPress={() => handleRestore(item.id, item.name)}
                    style={styles.restoreButton}
                  />
                )}
                {!showingRetired && (
                  <View style={styles.actions}>
                    <Button title="Edit" accessibilityLabel={`Edit ${item.name}`} variant="secondary" size="sm" disabled={pending} onPress={() => openEditor(item)} />
                    <Button title="Retire" accessibilityLabel={`Retire ${item.name}`} variant="danger" size="sm" disabled={pending} onPress={() => setRetiring(item)} />
                  </View>
                )}
              </Card>
            )}
          />
        )}
      </View>
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => { if (!pending) setEditorOpen(false); }}>
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView style={styles.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>{editingId === null ? 'Create service' : 'Edit service'}</Text>
              <ErrorMessage message={formError} />
              <Input label="Service name" value={draft.name} maxLength={100} editable={!pending} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
              <Input label="Price" value={draft.price} keyboardType="decimal-pad" editable={!pending} onChangeText={(price) => setDraft((current) => ({ ...current, price }))} />
              <Input label="Duration (minutes)" value={draft.durationMinutes} keyboardType="number-pad" editable={!pending} onChangeText={(durationMinutes) => setDraft((current) => ({ ...current, durationMinutes }))} />
              <Input label="Category" value={draft.category} maxLength={50} editable={!pending} onChangeText={(category) => setDraft((current) => ({ ...current, category }))} />
              <Input label="Description (optional)" value={draft.description} maxLength={500} multiline editable={!pending} onChangeText={(description) => setDraft((current) => ({ ...current, description }))} />
              <Button title="Save service" loading={createMutation.isPending || updateMutation.isPending} disabled={pending} onPress={save} />
              <Button title="Cancel" variant="secondary" disabled={pending} onPress={() => setEditorOpen(false)} style={styles.createButton} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <Modal visible={retiring !== null} transparent animationType="fade" onRequestClose={() => { if (!pending) setRetiring(null); }}>
        <View style={styles.confirmOverlay}>
          <Card>
            <Text style={styles.name}>Retire {retiring?.name}?</Text>
            <Text style={styles.description}>It will leave the booking menu. Services with existing bookings are kept in the retired list and can be restored; otherwise they are deleted.</Text>
            <Button title="Confirm retire" variant="danger" loading={retireMutation.isPending} disabled={pending} onPress={confirmRetire} style={styles.createButton} />
            <Button title="Cancel" variant="secondary" disabled={pending} onPress={() => setRetiring(null)} />
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  editor: { padding: 20, gap: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  createButton: { marginVertical: 12 },
  confirmOverlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.obsidian.bg },
  safeArea: {
    flex: 1,
    backgroundColor: colors.obsidian.bg,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  badgeLabel: {
    color: colors.gold.main,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  tabSelected: {
    backgroundColor: colors.obsidian.card,
    borderColor: colors.gold.main,
  },
  tabText: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tabTextSelected: {
    color: colors.gold.main,
  },
  successBanner: {
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    color: colors.status.approved,
    fontSize: 12,
    fontWeight: '500',
  },
  restoreButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  listContent: {
    paddingBottom: 20,
  },
  card: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  price: {
    color: colors.gold.bright,
    fontSize: 16,
    fontWeight: '800',
  },
  category: {
    color: colors.gold.main,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  description: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  duration: {
    color: colors.text.muted,
    fontSize: 12,
    marginTop: 8,
  },
});
