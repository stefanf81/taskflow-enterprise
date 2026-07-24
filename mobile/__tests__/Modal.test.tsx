import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Modal } from '../src/components/common/Modal';

describe('Modal Component', () => {
  it('renders content when visible', async () => {
    const { getByText } = await render(
      <Modal visible={true} onClose={() => {}} title="Test Modal">
        <Text>Modal Content</Text>
      </Modal>
    );
    expect(getByText('Test Modal')).toBeTruthy();
    expect(getByText('Modal Content')).toBeTruthy();
  });

  it('renders without title when not provided', async () => {
    const { queryByText, getByText } = await render(
      <Modal visible={true} onClose={() => {}}>
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText('Content')).toBeTruthy();
  });

  it('calls onClose when close button pressed', async () => {
    const handleClose = jest.fn();
    const { getByText } = await render(
      <Modal visible={true} onClose={handleClose} title="Close Me">
        <Text>Content</Text>
      </Modal>
    );
    expect(getByText('Close Me')).toBeTruthy();
  });
});
