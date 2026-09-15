import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { StylistCard, StylistProfile } from './stylist-card';

describe('StylistCard', () => {
  let fixture: ComponentFixture<StylistCard>;
  let component: StylistCard;

  const profile: StylistProfile = {
    name: 'Alex the Barber',
    title: 'Master Stylist',
    rating: '4.8 ★',
    reviews: '12 reviews',
    specialty: 'Classic Scissor Cuts',
    badge: 'Top Rated',
  };

  const card = (): HTMLElement => fixture.nativeElement.querySelector('button') as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StylistCard] });
    fixture = TestBed.createComponent(StylistCard);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
  });

  it('renders the stylist identity, rating, reviews and badge', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Alex the Barber');
    expect(text).toContain('Master Stylist');
    expect(text).toContain('4.8 ★');
    expect(text).toContain('12 reviews');
    expect(text).toContain('Top Rated');
    expect(text).toContain('A');
  });

  it('omits the badge when the profile has none', () => {
    fixture.componentRef.setInput('profile', { ...profile, badge: undefined });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Top Rated');
  });

  it('exposes an accessible selection label', () => {
    expect(card().getAttribute('aria-label')).toBe('Select stylist: Alex the Barber');
  });

  it('applies the selected class only when isSelected is true', () => {
    expect(fixture.nativeElement.querySelector('.selected-service-item')).toBeNull();
    fixture.componentRef.setInput('isSelected', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.selected-service-item')).not.toBeNull();
  });

  it('renders a native button so keyboard activation works without custom handlers', () => {
    expect(card().tagName).toBe('BUTTON');
    expect(card().getAttribute('type')).toBe('button');
  });

  it('emits selected when the card is clicked', () => {
    let emitted = 0;
    component.selected.subscribe(() => emitted++);
    card().click();
    expect(emitted).toBe(1);
  });
});
