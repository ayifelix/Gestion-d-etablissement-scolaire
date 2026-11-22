import { PrismaClient, SchoolCycle, YearStatus, PersonRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const roles = [
    ["ADM", "Administrateur technique"],
    ["DIR", "Direction"],
    ["CEN", "Censeur / directeur des études"],
    ["SG", "Surveillant général"],
    ["SEC", "Secrétariat"],
    ["ECO", "Économe / comptable"],
    ["PROF", "Professeur"],
    ["TIT", "Titulaire de classe"],
    ["PAR", "Parent / tuteur"],
    ["ELE", "Élève"],
    ["VERIFICATEUR", "Vérificateur"],
    ["SUPPLEANT_VERIF", "Suppléant de vérification"],
  ] as const;

  for (const [code, label] of roles) {
    await prisma.role.upsert({
      where: { code: code as PersonRole },
      update: { label },
      create: { code: code as PersonRole, label },
    });
  }

  const permissionCodes = [
    "structure.lire", "structure.gerer", "eleve.lire_identite",
    "eleve.creer", "eleve.modifier_etat_civil", "eleve.verifier_etat_civil",
    "inscription.creer", "enseignant.creer", "affectation.creer",
    "affectation.cloturer", "titulariat.designer", "site.gerer_contenu",
    "etablissement.gerer_identite", "admin.utilisateurs",
    "admin.roles", "admin.audit_lire", "admin.sauvegarde",
  ];
  for (const code of permissionCodes) {
    await prisma.permission.upsert({
      where: { code },
      update: { label: code, domain: code.split(".")[0] },
      create: { label: code, code, domain: code.split(".")[0] },
    });
  }

  const contentPermission = await prisma.permission.findUniqueOrThrow({ where: { code: "site.gerer_contenu" } });
  const identityPermission = await prisma.permission.findUniqueOrThrow({ where: { code: "etablissement.gerer_identite" } });
  const directionRole = await prisma.role.findUniqueOrThrow({ where: { code: PersonRole.DIR } });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: directionRole.id, permissionId: contentPermission.id } },
    update: {},
    create: { roleId: directionRole.id, permissionId: contentPermission.id },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: directionRole.id, permissionId: identityPermission.id } },
    update: {},
    create: { roleId: directionRole.id, permissionId: identityPermission.id },
  });

  const schoolIdentity = await prisma.schoolIdentity.upsert({
    where: { id: "school" },
    update: {},
    create: {
      id: "school",
      logoUrl: "/assets/etablissement/logo-128.webp",
      shortName: "Akonda",
      monogram: "AG",
    },
  });
  if (!schoolIdentity.logoUrl) {
    Object.assign(schoolIdentity, await prisma.schoolIdentity.update({
      where: { id: "school" },
      data: { logoUrl: "/assets/etablissement/logo-128.webp", shortName: "Akonda", monogram: "AG" },
    }));
  }
  const identityVersion = await prisma.schoolIdentityVersion.findUnique({
    where: { schoolIdentityId_version: { schoolIdentityId: schoolIdentity.id, version: schoolIdentity.version } },
  });
  if (!identityVersion) {
    const snapshot = {
      schoolName: schoolIdentity.schoolName,
      shortName: schoolIdentity.shortName,
      monogram: schoolIdentity.monogram,
      cycleSubtitle: schoolIdentity.cycleSubtitle,
      ministry: schoolIdentity.ministry,
      regionalDirectorate: schoolIdentity.regionalDirectorate,
      inspection: schoolIdentity.inspection,
      republicName: schoolIdentity.republicName,
      republicMotto: schoolIdentity.republicMotto,
      schoolMotto: schoolIdentity.schoolMotto,
      address: schoolIdentity.address,
      phone: schoolIdentity.phone,
      email: schoolIdentity.email,
      secretariatHours: schoolIdentity.secretariatHours,
      headName: schoolIdentity.headName,
      headMessage: schoolIdentity.headMessage,
      collegePresentation: schoolIdentity.collegePresentation,
      lyceePresentation: schoolIdentity.lyceePresentation,
      directionsUrl: schoolIdentity.directionsUrl,
      logoUrl: schoolIdentity.logoUrl,
      compactLogoUrl: schoolIdentity.compactLogoUrl,
      logoVersionId: schoolIdentity.logoVersionId,
      photoUrl: schoolIdentity.photoUrl,
      version: schoolIdentity.version,
    };
    await prisma.schoolIdentityVersion.create({
      data: {
        schoolIdentityId: schoolIdentity.id,
        version: schoolIdentity.version,
        snapshot,
        createdBy: "seed",
      },
    });
  }

  await prisma.cycle.upsert({
    where: { code: SchoolCycle.COLLEGE },
    update: {},
    create: { code: SchoolCycle.COLLEGE, label: "Collège" },
  });
  await prisma.cycle.upsert({
    where: { code: SchoolCycle.LYCEE },
    update: {},
    create: { code: SchoolCycle.LYCEE, label: "Lycée" },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { identifier: "admin" } });
  if (!existingAdmin) {
    const person = await prisma.person.create({
      data: { nom: "Administrateur", prenoms: "Système" },
    });
    const user = await prisma.user.create({
      data: {
        personId: person.id,
        identifier: "admin",
        passwordHash: await bcrypt.hash("Admin#2026", 12),
        active: true,
        twoFactorActive: false,
      },
    });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: PersonRole.ADM } });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: adminRole.id,
        scopeType: "ETABLISSEMENT",
        dateStart: new Date(),
        assignedBy: user.id,
      },
    });
  }

  await prisma.academicYear.upsert({
    where: { label: "2026-2027" },
    update: {},
    create: {
      label: "2026-2027",
      dateStart: new Date("2026-09-01T00:00:00+00:00"),
      dateEnd: new Date("2027-07-31T00:00:00+00:00"),
      status: YearStatus.ACTIVE,
      periods: {
        create: [
          { number: 1, label: "Trimestre 1", dateStart: new Date("2026-09-01"), dateEnd: new Date("2026-12-20") },
          { number: 2, label: "Trimestre 2", dateStart: new Date("2027-01-04"), dateEnd: new Date("2027-03-31") },
          { number: 3, label: "Trimestre 3", dateStart: new Date("2027-04-01"), dateEnd: new Date("2027-07-31") },
        ],
      },
    },
  });

  const academicYear = await prisma.academicYear.findUniqueOrThrow({ where: { label: "2026-2027" } });
  const cycles = await prisma.cycle.findMany();
  for (const cycle of cycles) {
    const rule = await prisma.calculationRule.findFirst({
      where: { yearId: academicYear.id, cycleId: cycle.id, version: 1 },
    });
    if (!rule) {
      await prisma.calculationRule.create({
        data: {
          yearId: academicYear.id,
          cycleId: cycle.id,
          version: 1,
          classworkWeight: 0.5,
          compositionWeight: 0.5,
          annualPeriodWeights: [1, 1, 1],
          roundingDigits: 2,
          createdBy: "seed",
        },
      });
    }
  }

  const demoUsers = new Map<PersonRole, { userId: string; personId: string }>();
  const demoPasswordHash = await bcrypt.hash("Demo#2026", 12);
  for (const [code] of roles) {
    const roleCode = code as PersonRole;
    let user = await prisma.user.findUnique({ where: { identifier: `demo-${code.toLowerCase()}` } });
    if (!user) {
      const person = await prisma.person.create({
        data: { nom: "Démo", prenoms: labelForRole(code) },
      });
      user = await prisma.user.create({
        data: {
          personId: person.id,
          identifier: `demo-${code.toLowerCase()}`,
          passwordHash: demoPasswordHash,
          twoFactorActive: false,
        },
      });
    }
    demoUsers.set(roleCode, { userId: user.id, personId: user.personId });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const assignment = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id } });
    if (!assignment) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          scopeType: "ETABLISSEMENT",
          dateStart: new Date("2026-09-01T00:00:00.000Z"),
          assignedBy: user.id,
        },
      });
    }
  }

  const college = await prisma.cycle.findUniqueOrThrow({ where: { code: SchoolCycle.COLLEGE } });
  const level = await prisma.level.upsert({
    where: { code: "3E" },
    update: { label: "3e", cycleId: college.id, order: 4 },
    create: { code: "3E", label: "3e", cycleId: college.id, order: 4, examCode: "BEPC" },
  });
  const existingPathway = await prisma.pathway.findFirst({
    where: { levelId: level.id, filiereId: null },
  });
  const pathway = existingPathway
    ? await prisma.pathway.update({ where: { id: existingPathway.id }, data: { label: "3e générale" } })
    : await prisma.pathway.create({ data: { levelId: level.id, label: "3e générale" } });
  const schoolClass = await prisma.schoolClass.upsert({
    where: { yearId_name: { yearId: academicYear.id, name: "3e A — Démonstration" } },
    update: { pathwayId: pathway.id, maxCapacity: 60 },
    create: { yearId: academicYear.id, pathwayId: pathway.id, name: "3e A — Démonstration", maxCapacity: 60 },
  });
  const mathematics = await prisma.subject.upsert({
    where: { code: "DEMO-MATH" },
    update: { label: "Mathématiques (démo)", abbreviation: "MATH" },
    create: { code: "DEMO-MATH", label: "Mathématiques (démo)", abbreviation: "MATH" },
  });
  await prisma.subjectProgram.upsert({
    where: { yearId_pathwayId_subjectId: { yearId: academicYear.id, pathwayId: pathway.id, subjectId: mathematics.id } },
    update: { coefficient: 1, weeklyHours: 1, scale: 20 },
    create: {
      yearId: academicYear.id,
      pathwayId: pathway.id,
      subjectId: mathematics.id,
      coefficient: 1,
      weeklyHours: 1,
      scale: 20,
    },
  });

  for (const roleCode of [PersonRole.PROF, PersonRole.TIT] as const) {
    const demo = demoUsers.get(roleCode);
    if (!demo) continue;
    await prisma.teacher.upsert({
      where: { personId: demo.personId },
      update: { status: "VOLONTAIRE" },
      create: { personId: demo.personId, status: "VOLONTAIRE", specialties: ["MATH"] },
    });
  }
  const demoTeacher = await prisma.teacher.findUniqueOrThrow({
    where: { personId: demoUsers.get(PersonRole.PROF)!.personId },
  });
  const assignment = await prisma.teachingAssignment.findFirst({
    where: { teacherId: demoTeacher.id, classId: schoolClass.id, subjectId: mathematics.id, yearId: academicYear.id },
  });
  if (!assignment) {
    await prisma.teachingAssignment.create({
      data: {
        teacherId: demoTeacher.id,
        classId: schoolClass.id,
        subjectId: mathematics.id,
        yearId: academicYear.id,
        weeklyHours: 1,
        dateStart: academicYear.dateStart,
        createdBy: demoUsers.get(PersonRole.DIR)!.userId,
      },
    });
  }
  const titular = await prisma.teacher.findUniqueOrThrow({
    where: { personId: demoUsers.get(PersonRole.TIT)!.personId },
  });
  const titulariat = await prisma.titulariat.findUnique({
    where: { classId_yearId: { classId: schoolClass.id, yearId: academicYear.id } },
  });
  if (!titulariat) {
    await prisma.titulariat.create({
      data: {
        classId: schoolClass.id,
        teacherId: titular.id,
        yearId: academicYear.id,
        type: "TITULAIRE",
        dateStart: academicYear.dateStart,
      },
    });
  }

  const demoStudentPerson = await prisma.person.upsert({
    where: { id: "00000000-0000-4000-8000-000000000101" },
    update: { nom: "Afi", prenoms: "Démonstration" },
    create: { id: "00000000-0000-4000-8000-000000000101", nom: "Afi", prenoms: "Démonstration", sexe: "F" },
  });
  const demoStudent = await prisma.student.upsert({
    where: { matricule: "DEMO-2026-000001" },
    update: { personId: demoStudentPerson.id, isDemo: true },
    create: {
      personId: demoStudentPerson.id,
      matricule: "DEMO-2026-000001",
      dateAdmission: academicYear.dateStart,
      isDemo: true,
    },
  });
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_yearId: { studentId: demoStudent.id, yearId: academicYear.id } },
  });
  if (!enrollment) {
    await prisma.enrollment.create({
      data: {
        studentId: demoStudent.id,
        yearId: academicYear.id,
        classId: schoolClass.id,
        type: "NOUVEAU",
        dateStart: academicYear.dateStart,
      },
    });
  }

  console.log("Seed de démonstration J1/J2 terminé — données et coefficients fictifs");
}

function labelForRole(code: string) {
  const labels: Record<string, string> = {
    ADM: "Administrateur",
    DIR: "Direction",
    CEN: "Censeur",
    SG: "Surveillant",
    SEC: "Secrétariat",
    ECO: "Économe",
    PROF: "Professeur",
    TIT: "Titulaire",
    PAR: "Parent",
    ELE: "Élève",
    VERIFICATEUR: "Vérificateur",
    SUPPLEANT_VERIF: "Suppléant",
  };
  return labels[code] ?? "Utilisateur";
}

main().finally(() => prisma.$disconnect());
