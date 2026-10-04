# Product image lifecycle

Product image compression is unchanged: static WebP, maximum edge 1280 px,
200 KiB, stripped metadata, immutable cache.

Every PostgreSQL product image/gallery change (including catalog sync, bulk SQL,
and product deletion) atomically records removed canonical object paths in
`product_image_retirements`. The primary URL and removed gallery entries get
seven days from their latest removal. Restoring/reusing a reference protects
it; subsequent removal starts a new window. SQLite uses a corresponding ORM
listener for local development/tests (raw SQLite SQL is not the production path).

The PostgreSQL trigger and collector serialize image decisions with a short
transaction advisory lock. This works with transaction pooling. Before a remote
DELETE, the collector checks references across **all** products, including inactive
products and galleries, through a narrowly scoped boolean SECURITY DEFINER
helper. The helper validates tenant context and fails closed if its owner cannot
bypass RLS (`row_security=off`). It conservatively matches decoded filenames;
a filename collision can retain excess bytes, never remove a referenced image.

Deletion intent is committed before contacting Storage. A trigger prevents all
writes from reattaching an object in `deleting` or `deleted` state. This closes
the check/delete race and the crash-after-DELETE gap without holding DB locks or
transactions during network waits. Retries are delayed one hour. 200/204/404 are
successful terminal outcomes. A network failure leaves a fenced candidate for
retry, because the remote outcome may be unknown. The terminal record remains
as a tombstone. Rollback is available during retention; after deletion intent,
a new upload is required. The DELETE product-photo endpoint clears references
immediately and now uses the same retention policy, protecting shared images.

The existing backend worker lifecycle starts a small hourly maintenance loop.
**It defaults to dry-run.** Actual collection requires an explicit deployment
setting `PRODUCT_IMAGE_GC_EXECUTE=true`. Disabling it returns the worker to
inspection. `ENABLE_OUTBOX_WORKER=false` also disables this maintenance loop.
No Print Agent change is required. No production cleanup was authorized for
implementation/verification. Enable execution only after reviewing inventories
and the deployed migration. No manual SQL is required for normal operation.

Run tools from the repository with the normal backend environment and
`PYTHONPATH=backend`. Credentials are read from the existing environment and are
never included in reports.

```sh
python -m tools.product_image_gc reconcile --tenant 6
python -m tools.product_image_gc reconcile --all-tenants
python -m tools.product_image_gc collect --all-tenants
```

`reconcile` lists only the exact `<tenant>/products/` prefix in `cardapio-assets`,
with pagination. Its report contains tenant, object path, bytes, creation time,
age, current reference status, eligibility and reason, plus recoverable bytes,
retention-protected objects and referenced objects. Missing age/invalid paths
fail closed. Minimum object age defaults to seven days and cannot be reduced
below seven (`--min-age-days` can increase it).

```sh
# Explicit enrollment ONLY: does not delete objects.
python -m tools.product_image_gc reconcile --all-tenants --execute
# Explicit deletion ONLY of already enrolled, due, revalidated objects.
python -m tools.product_image_gc collect --all-tenants --execute
```

Legacy objects receive a **fresh seven-day observation window at enrollment**,
even if their creation date is old. Repeated reconciliation does not restart
that window. Therefore inventory recoverable bytes are a potential future
saving, not bytes eligible for immediate deletion. Newly uploaded objects whose
DB reference commit failed can also be found by reconciliation after the minimum
age. Reconciliation is an explicit maintenance operation; the hourly worker only
processes the durable queue, never automatically discovers and deletes old files.

Validate with the focused lifecycle/optimization tests and the PostgreSQL CI
job. PostgreSQL concurrency fixtures create/drop disposable local test databases;
Storage requests are mocked. Live inventories must never invoke `--execute` as
part of development or validation.
