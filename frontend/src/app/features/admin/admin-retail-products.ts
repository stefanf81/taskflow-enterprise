import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { RetailProductResponse, retailProductSchema } from '@taskflow/schemas';
import { RetailProductsApi } from '../../core/api/retail-products-api';
import { extractApiError } from '../../core/api/extract-api-error';
import { RetailProductStore } from '../../core/catalog/retail-product.store';
import { formatUsd } from '../../core/format';
import { Alert } from '../../core/ui/alert';
import { Button } from '../../core/ui/button';
import { EmptyState } from '../../core/ui/empty-state';
import { sprayCanIcon } from '../../core/ui/icons/spray-can';

interface ProductDraft {
  name: string;
  sizeLabel: string;
  price: string;
  sortOrder: string;
}

const emptyDraft = (position: number): ProductDraft => ({
  name: '',
  sizeLabel: '',
  price: '',
  sortOrder: String(position),
});

/**
 * Owner dashboard · service catalog tab · retail products: the products the landing pages list
 * (display only, never booked). Add, edit and delete; every save reloads the shared store, so the
 * owner sees the list the guests will see.
 */
@Component({
  selector: 'app-admin-retail-products',
  imports: [Alert, Button, EmptyState],
  template: `
    <section class="space-y-4 pt-2" aria-labelledby="retail-products-heading">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="retail-products-heading" class="text-white font-bold text-lg">Retail products</h3>
          <p class="text-xs text-zinc-400 font-light">
            Shown on the landing page and in the app. Display only: they are not booked.
          </p>
        </div>
        <button type="button" appButton [disabled]="isSaving()" (click)="openEditor()">
          Add product
        </button>
      </div>

      @if (actionSuccess(); as message) {
        <app-alert tone="success" dismissible (dismissed)="actionSuccess.set(null)">
          {{ message }}
        </app-alert>
      }
      @if (actionError(); as message) {
        <app-alert tone="error" dismissible (dismissed)="actionError.set(null)">
          {{ message }}
        </app-alert>
      }

      @if (editorOpen()) {
        <form
          class="space-y-4 rounded-xl border border-white/10 p-4"
          novalidate
          (submit)="save($event)"
          aria-labelledby="product-editor-heading"
        >
          <h4 id="product-editor-heading" class="text-white font-bold">
            {{ editingId() === null ? 'Add product' : 'Edit product' }}
          </h4>
          <fieldset class="grid gap-4 sm:grid-cols-2" [disabled]="isSaving()">
            <div class="sm:col-span-2">
              <label for="product-name" class="block text-xs text-zinc-300 mb-1">Name</label>
              <input
                id="product-name"
                class="form-control w-full"
                autocomplete="off"
                maxlength="100"
                [value]="draft().name"
                (input)="updateDraft('name', $any($event.target).value)"
              />
            </div>
            <div>
              <label for="product-size" class="block text-xs text-zinc-300 mb-1"
                >Size (optional)</label
              >
              <input
                id="product-size"
                class="form-control w-full"
                autocomplete="off"
                maxlength="30"
                placeholder="100ml"
                [value]="draft().sizeLabel"
                (input)="updateDraft('sizeLabel', $any($event.target).value)"
              />
            </div>
            <div>
              <label for="product-price" class="block text-xs text-zinc-300 mb-1">Price</label>
              <input
                id="product-price"
                class="form-control w-full"
                type="number"
                min="0.01"
                step="0.01"
                [value]="draft().price"
                (input)="updateDraft('price', $any($event.target).value)"
              />
            </div>
            <div>
              <label for="product-position" class="block text-xs text-zinc-300 mb-1"
                >Position in the list</label
              >
              <input
                id="product-position"
                class="form-control w-full"
                type="number"
                min="0"
                step="1"
                [value]="draft().sortOrder"
                (input)="updateDraft('sortOrder', $any($event.target).value)"
              />
            </div>
          </fieldset>
          <div class="flex gap-3">
            <button type="submit" appButton [disabled]="isSaving()">
              {{ isSaving() ? 'Saving…' : 'Save product' }}
            </button>
            <button
              type="button"
              appButton="secondary"
              [disabled]="isSaving()"
              (click)="editorOpen.set(false)"
            >
              Cancel
            </button>
          </div>
        </form>
      }

      @if (store.errorMessage(); as message) {
        <app-empty-state kind="error" [title]="message">
          <button type="button" appButton="secondary" (click)="store.reload()">Retry</button>
        </app-empty-state>
      } @else if (!store.hasLoaded()) {
        <app-empty-state kind="loading" title="Loading products…" />
      } @else if (store.products().length === 0) {
        <app-empty-state
          [icon]="sprayCanIcon"
          title="No retail products"
          description="Add the products you sell in the shop to show them to your clients."
        />
      } @else {
        <ul class="space-y-3">
          @for (product of store.products(); track product.id) {
            <li
              class="p-4 rounded-xl border border-white/5 bg-zinc-900/50 flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p class="text-sm font-bold text-white">
                  {{ product.name }}
                  @if (product.sizeLabel) {
                    <span class="text-zinc-400 font-normal">({{ product.sizeLabel }})</span>
                  }
                </p>
                <p class="text-xs text-zinc-500 mt-1">
                  <span class="text-accent font-bold">{{ formatUsd(product.price) }}</span>
                  · position {{ product.sortOrder }}
                </p>
              </div>
              <div class="flex gap-2">
                @if (deletingId() === product.id) {
                  <button
                    type="button"
                    appButton="danger"
                    [disabled]="isSaving()"
                    (click)="confirmDelete(product)"
                  >
                    Delete {{ product.name }}?
                  </button>
                  <button
                    type="button"
                    appButton="secondary"
                    [disabled]="isSaving()"
                    (click)="deletingId.set(null)"
                  >
                    Keep
                  </button>
                } @else {
                  <button
                    type="button"
                    appButton="secondary"
                    [disabled]="isSaving()"
                    (click)="openEditor(product)"
                  >
                    Edit<span class="sr-only"> {{ product.name }}</span>
                  </button>
                  <button
                    type="button"
                    appButton="secondary"
                    [disabled]="isSaving()"
                    (click)="deletingId.set(product.id)"
                  >
                    Delete<span class="sr-only"> {{ product.name }}</span>
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class AdminRetailProducts {
  private readonly api = inject(RetailProductsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(RetailProductStore);
  protected readonly formatUsd = formatUsd;
  protected readonly sprayCanIcon = sprayCanIcon;

  protected readonly editorOpen = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly deletingId = signal<number | null>(null);
  protected readonly draft = signal<ProductDraft>(emptyDraft(1));
  protected readonly isSaving = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly actionSuccess = signal<string | null>(null);

  protected openEditor(product?: RetailProductResponse): void {
    if (this.isSaving()) return;
    const last = this.store.products().at(-1)?.sortOrder ?? 0;
    this.editingId.set(product?.id ?? null);
    this.draft.set(
      product
        ? {
            name: product.name,
            sizeLabel: product.sizeLabel,
            price: String(product.price),
            sortOrder: String(product.sortOrder),
          }
        : emptyDraft(last + 1),
    );
    this.deletingId.set(null);
    this.actionError.set(null);
    this.editorOpen.set(true);
  }

  protected updateDraft(field: keyof ProductDraft, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (this.isSaving()) return;
    const draft = this.draft();
    const parsed = retailProductSchema.safeParse({
      name: draft.name,
      sizeLabel: draft.sizeLabel.trim() || undefined,
      price: Number(draft.price),
      sortOrder: Number(draft.sortOrder),
    });
    if (!parsed.success) {
      this.actionError.set(parsed.error.issues[0]?.message ?? 'Please check the product details.');
      return;
    }
    const id = this.editingId();
    this.run(
      id === null ? this.api.createProduct(parsed.data) : this.api.updateProduct(id, parsed.data),
      (saved) => {
        this.editorOpen.set(false);
        return `${saved.name} ${id === null ? 'added' : 'updated'}.`;
      },
      'Could not save the product. Please try again.',
    );
  }

  protected confirmDelete(product: RetailProductResponse): void {
    if (this.isSaving()) return;
    this.run(
      this.api.deleteProduct(product.id),
      () => {
        this.deletingId.set(null);
        return `${product.name} removed.`;
      },
      'Could not delete the product. Please try again.',
    );
  }

  private run<T>(
    request: Observable<T>,
    onSuccess: (value: T) => string,
    fallbackError: string,
  ): void {
    this.isSaving.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (value) => {
        this.isSaving.set(false);
        this.actionSuccess.set(onSuccess(value));
        this.store.reload();
      },
      error: (error) => {
        this.isSaving.set(false);
        this.actionError.set(extractApiError(error, fallbackError));
      },
    });
  }
}
