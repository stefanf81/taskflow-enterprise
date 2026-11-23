import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { RetailProductResponse, retailProductSchema } from '@taskflow/schemas';
import { formatUsd } from '@taskflow/domain';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Card } from '../../components/common/Card';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorState } from '../../components/common/ErrorState';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { useFlashMessage } from '../../components/common/useFlashMessage';
import {
  useDeleteRetailProduct,
  useRetailProducts,
  useSaveRetailProduct,
} from '../../core/catalog/useRetailProducts';
import { colors, semantic, withAlpha } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

type ProductDraft = { name: string; sizeLabel: string; price: string; sortOrder: string };

/**
 * Owner · catalog · "Products" tab: the retail products both landing pages list (display only,
 * never booked). Add, edit, delete; every save refetches the shared list.
 */
export const RetailProductsPanel: React.FC = () => {
  const { data: products = [], isLoading, isError, refetch } = useRetailProducts();
  const saveMutation = useSaveRetailProduct();
  const deleteMutation = useDeleteRetailProduct();
  const pending = saveMutation.isPending || deleteMutation.isPending;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { successMessage, errorMessage, showSuccess, showError } = useFlashMessage();

  const openEditor = (product?: RetailProductResponse) => {
    if (pending) return;
    const last = products.at(-1)?.sortOrder ?? 0;
    setEditingId(product?.id ?? null);
    setDraft(
      product
        ? { name: product.name, sizeLabel: product.sizeLabel, price: String(product.price), sortOrder: String(product.sortOrder) }
        : { name: '', sizeLabel: '', price: '', sortOrder: String(last + 1) },
    );
    setFormError('');
    setDeletingId(null);
  };

  const save = () => {
    if (!draft || pending) return;
    const price = draft.price.trim().replace(',', '.');
    const sortOrder = draft.sortOrder.trim();
    const parsed = retailProductSchema.safeParse({
      name: draft.name,
      sizeLabel: draft.sizeLabel.trim() || undefined,
      price: price === '' ? NaN : Number(price),
      sortOrder: sortOrder === '' ? NaN : Number(sortOrder),
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Please check the product details.');
      return;
    }
    saveMutation.mutate(
      { id: editingId, request: parsed.data },
      {
        onSuccess: (saved) => {
          setDraft(null);
          showSuccess(`${saved.name} ${editingId === null ? 'added' : 'updated'}.`);
        },
        onError: (err) => setFormError(getApiErrorMessage(err, 'Could not save the product. Please try again.')),
      },
    );
  };

  const confirmDelete = (product: RetailProductResponse) => {
    if (pending) return;
    deleteMutation.mutate(product.id, {
      onSuccess: () => {
        setDeletingId(null);
        showSuccess(`${product.name} removed.`);
      },
      onError: (err) => showError(getApiErrorMessage(err, `Could not delete ${product.name}.`)),
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>Shown on the home screen and the website. Display only: they are not booked.</Text>
      <ErrorMessage message={errorMessage || ''} />
      {successMessage && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      )}

      {draft ? (
        <Card style={styles.card}>
          <Text style={styles.name}>{editingId === null ? 'Add product' : 'Edit product'}</Text>
          <ErrorMessage message={formError} />
          <Input label="Name" value={draft.name} maxLength={100} editable={!pending} autoComplete="off" onChangeText={(name) => setDraft({ ...draft, name })} />
          <Input label="Size (optional)" placeholder="100ml" value={draft.sizeLabel} maxLength={30} editable={!pending} autoComplete="off" onChangeText={(sizeLabel) => setDraft({ ...draft, sizeLabel })} />
          <Input label="Price" value={draft.price} keyboardType="decimal-pad" editable={!pending} onChangeText={(value) => setDraft({ ...draft, price: value })} />
          <Input label="Position in the list" value={draft.sortOrder} keyboardType="number-pad" editable={!pending} onChangeText={(value) => setDraft({ ...draft, sortOrder: value })} />
          <Button title="Save product" loading={saveMutation.isPending} disabled={pending} onPress={save} />
          <Button title="Cancel" variant="secondary" disabled={pending} onPress={() => setDraft(null)} style={styles.spaced} />
        </Card>
      ) : (
        <Button title="Add product" disabled={pending} onPress={() => openEditor()} style={styles.addButton} />
      )}

      {isError ? (
        <ErrorState message="Couldn't load the products." onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingIndicator message="Loading products..." />
      ) : products.length === 0 ? (
        <EmptyState icon="basket-outline" title="No Retail Products" message="Add the products you sell in the shop to show them to your clients." />
      ) : (
        products.map((product) => (
          <Card key={product.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>
                {product.name}
                {product.sizeLabel ? ` (${product.sizeLabel})` : ''}
              </Text>
              <Text style={styles.price}>{formatUsd(product.price)}</Text>
            </View>
            <Text style={styles.position}>Position {product.sortOrder}</Text>
            {deletingId === product.id ? (
              <View style={styles.actions}>
                <Button title={`Delete ${product.name}?`} variant="danger" size="sm" loading={deleteMutation.isPending} disabled={pending} onPress={() => confirmDelete(product)} />
                <Button title="Keep" variant="secondary" size="sm" disabled={pending} onPress={() => setDeletingId(null)} />
              </View>
            ) : (
              <View style={styles.actions}>
                <Button title="Edit" accessibilityLabel={`Edit ${product.name}`} variant="secondary" size="sm" disabled={pending} onPress={() => openEditor(product)} />
                <Button title="Delete" accessibilityLabel={`Delete ${product.name}`} variant="danger" size="sm" disabled={pending} onPress={() => setDeletingId(product.id)} />
              </View>
            )}
          </Card>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  hint: {
    color: colors.text.secondary,
    fontSize: 12,
    marginBottom: 12,
  },
  successBanner: {
    backgroundColor: withAlpha(semantic.success, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(semantic.success, 0.3),
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  successText: {
    color: semantic.success,
    fontSize: 13,
  },
  addButton: {
    marginBottom: 16,
  },
  spaced: {
    marginTop: 8,
  },
  card: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  name: {
    color: colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  price: {
    color: colors.gold.main,
    fontSize: 15,
    fontWeight: '700',
  },
  position: {
    color: colors.text.muted,
    fontSize: 12,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
});
