import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Card } from '../../components/common/Card';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { useCreateBarber } from '../../core/barbers/useBarbers';
import type { Barber } from '../../types/api';
import { colors } from '../../theme/colors';
import { getApiErrorMessage } from '../../utils/errors';

interface AddBarberCardProps {
  onCreated: (barber: Barber) => void;
  onMessage: (message: { error?: string; success?: string }) => void;
}

/** Adds a barber (mobile twin of the web form); the server gives them the default week. */
export const AddBarberCard: React.FC<AddBarberCardProps> = ({ onCreated, onMessage }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const createMutation = useCreateBarber();

  const handleCreate = () => {
    if (createMutation.isPending) return;
    if (!name.trim()) {
      onMessage({ error: 'Barber name is required.' });
      return;
    }
    onMessage({});
    createMutation.mutate(
      { name: name.trim(), email: email.trim(), phone: phone.trim() },
      {
        onSuccess: (created) => {
          setName('');
          setEmail('');
          setPhone('');
          onMessage({ success: `Barber ${created.name} added.` });
          onCreated(created);
        },
        onError: (err) =>
          onMessage({ error: getApiErrorMessage(err, 'Failed to create barber. Please try again.') }),
      },
    );
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Add Barber</Text>
      <Input label="Name *" placeholder="Jordan" value={name} onChangeText={setName} />
      <Input
        label="Email"
        placeholder="jordan@example.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Input
        label="Phone"
        placeholder="555-0100"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Button
        title="Add Barber"
        variant="secondary"
        loading={createMutation.isPending}
        onPress={handleCreate}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
  },
  title: {
    color: colors.gold.main,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
});
