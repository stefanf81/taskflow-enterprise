import React from 'react';
import { Modal as RNModal, View, Text, TouchableOpacity, StyleSheet, ModalProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

interface CustomModalProps extends ModalProps {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const Modal: React.FC<CustomModalProps> = ({ title, onClose, visible, children, ...props }) => {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      {...props}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            {title ? <Text style={styles.title}>{title}</Text> : <View />}
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.body}>{children}</View>
        </View>
      </View>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: colors.obsidian.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.gold.border,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.obsidian.border,
    paddingBottom: 12,
  },
  title: {
    color: colors.gold.main,
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    paddingVertical: 8,
  },
});
